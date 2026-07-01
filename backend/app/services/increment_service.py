"""
Apply an effective-dated salary increment.

Increments ALWAYS take effect from the 1st of a month (the start of a calendar
pay period). Never mid-month. One payslip = one structure — the month an
increment is granted stays at the old rate; the new rate applies from the 1st
of the following month.

The active structure is closed (effective_to = effective_from - 1 day) and a
new active structure is inserted. The employees salary columns are kept in sync
as a cache of the active structure so all existing read paths keep working.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from sqlalchemy.orm import Session

from app.models.employee import AuditLog, Employee, SalaryStructure
from app.services.salary_resolver import get_active_structure

# Salary components carried forward / synced to the employees row.
# medical (Session 22) is a paid earning IN gross, so it carries forward and counts
# toward statutory gross; other_earning is paid but NON-statutory (excluded from gross).
_COMPONENTS = ("basic", "hra", "spl", "cca", "leave_travel", "medical", "other_earning")

# Components that count toward statutory gross (other_earning is excluded — paid but non-statutory).
_STATUTORY = ("basic", "hra", "spl", "cca", "leave_travel", "medical")


def _to_dec(v) -> Decimal:
    return Decimal(str(v)) if v is not None else Decimal("0")


def apply_increment(
    db: Session,
    emp_code: str,
    effective_from: date,
    new_values: dict,
    reason: str,
    actor_emp_code: str,
) -> SalaryStructure:
    """
    Build a new active salary structure. Commits are left to the caller.

    new_values may contain any subset of the 7 salary components; omitted
    components are carried forward from the current active structure.
    """
    # 1. Effective date must be the 1st of a month (calendar pay-period start).
    if effective_from.day != 1:
        raise ValueError(
            "Increment must be effective from the 1st of the month"
        )

    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if emp is None:
        raise ValueError(f"Employee {emp_code} not found")

    # 2. Current active structure. Employees onboarded via bulk import (or single
    #    create) never got a seed structure — only increments create them — so
    #    bootstrap a baseline from the live employee salary columns. Payroll already
    #    falls back to those same columns, so this adds the missing history row
    #    without changing any figure, giving the increment something to supersede.
    active = get_active_structure(db, emp_code)
    if active is None:
        baseline_from = (
            emp.doj if (emp.doj and emp.doj < effective_from)
            else effective_from - timedelta(days=1)
        )
        active = SalaryStructure(
            emp_code       = emp_code,
            effective_from = baseline_from,
            effective_to   = None,
            reason         = "correction",
            created_by     = actor_emp_code,
            **{c: _to_dec(getattr(emp, c)) for c in _COMPONENTS},
        )
        db.add(active)
        db.flush()

    # 3. Cannot backdate before the current structure's start.
    if effective_from <= active.effective_from:
        raise ValueError(
            f"effective_from ({effective_from}) must be after the current "
            f"structure's effective_from ({active.effective_from})"
        )

    # 4. Validate reason.
    if reason not in ("increment", "correction"):
        raise ValueError("reason must be 'increment' or 'correction'")

    # Snapshot old components for the audit trail.
    old_components = {c: float(_to_dec(getattr(active, c))) for c in _COMPONENTS}

    # 5. Resolve new components — carry forward anything not supplied.
    resolved = {}
    for c in _COMPONENTS:
        if new_values.get(c) is not None:
            resolved[c] = _to_dec(new_values[c])
        else:
            resolved[c] = _to_dec(getattr(active, c))

    # 4. Close the active row. Flush before inserting the new active row so the
    #    non-deferrable partial unique index (one NULL effective_to per emp) never
    #    sees two active rows transiently within the same flush.
    active.effective_to = effective_from - timedelta(days=1)
    db.flush()

    # 5. Insert the new active structure.
    new_struct = SalaryStructure(
        emp_code       = emp_code,
        effective_from = effective_from,
        effective_to   = None,
        reason         = reason,
        created_by     = actor_emp_code,
        **resolved,
    )
    db.add(new_struct)

    # 6. Sync the employees row columns to the new active structure.
    for c in _COMPONENTS:
        setattr(emp, c, resolved[c])

    # 7. Enforce the ESIC ceiling on the new statutory gross — but only ever turn
    #    it OFF (over ₹21k). A manual opt-out is preserved while under the ceiling.
    statutory_gross = sum(resolved[c] for c in _STATUTORY)
    if statutory_gross > Decimal("21000") and emp.esic_applicable:
        emp.esic_applicable = False

    # Flush so the new structure gets an id for the audit record_id.
    db.flush()

    # 8. Audit log.
    new_components = {c: float(resolved[c]) for c in _COMPONENTS}
    db.add(AuditLog(
        user_code  = actor_emp_code,
        action     = "INCREMENT",
        table_name = "salary_structures",
        record_id  = str(new_struct.id),
        old_values = old_components,
        new_values = {
            **new_components,
            "effective_from": str(effective_from),
            "reason":         reason,
        },
    ))

    # 9. Return (caller commits).
    return new_struct


# ---------------------------------------------------------------------------
# Bulk increment — CSV-driven, one row per employee
# ---------------------------------------------------------------------------

# abs_<field> sets one component to an absolute amount.
_ABS_FIELD = {
    "abs_basic":  "basic",
    "abs_hra":    "hra",
    "abs_spl":    "spl",
    "abs_cca":    "cca",
    "abs_lta":    "leave_travel",
    "abs_other":  "other_earning",
}
_VALID_MODES = ("pct", "flat") + tuple(_ABS_FIELD)


def resolve_increment(active: SalaryStructure, mode: str, value: Decimal) -> dict:
    """Turn a (mode, value) pair into a new_values component dict vs the active
    structure. Omitted components are carried forward by apply_increment.

      pct        → raise every component by value%
      flat       → add value rupees to basic
      abs_<fld>  → set that one component to value (abs_basic/hra/spl/cca/lta/other)
    """
    mode = (mode or "").strip().lower()
    if mode == "pct":
        factor = Decimal(1) + (value / Decimal(100))
        return {c: (_to_dec(getattr(active, c)) * factor).quantize(Decimal("0.01"))
                for c in _COMPONENTS}
    if mode == "flat":
        return {"basic": _to_dec(active.basic) + value}
    if mode in _ABS_FIELD:
        return {_ABS_FIELD[mode]: value}
    raise ValueError(
        f"unknown mode '{mode}' — use pct / flat / " + " / ".join(_ABS_FIELD)
    )


def _parse_inc_date(raw) -> Optional[date]:
    """Accept YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY."""
    if not raw:
        return None
    s = str(raw).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


# Salary-sheet-style template column → structure component. The user types the NEW
# absolute value per component; blank = carry the current value forward.
# "Other Allowance" is the DISPLAY label for other_earning (the fixed component) after
# the Session-22 terminology swap.
# Keys include both the DISPLAY headers and the CANONICAL names that parse_upload_file
# rewrites them to via the shared import column-map (e.g. LTA→leave_travel, Other
# Allowance→other_earning) — so the columns are found whether parsed raw or pre-renamed.
_INC_COMPONENT_COLS = {
    "basic": "basic",
    "hra": "hra", "house rent allow": "hra", "house rent allowance": "hra",
    "medical": "medical", "medical allow": "medical", "medical allowance": "medical",
    "spl": "spl", "special": "spl", "special allow": "spl", "special allowance": "spl",
    "cca": "cca", "city comp allow": "cca", "city compensatory allowance": "cca",
    "leave_travel": "leave_travel", "lta": "leave_travel",
    "leave travel": "leave_travel", "leave travel allow": "leave_travel",
    "other_earning": "other_earning", "other allowance": "other_earning", "other allow": "other_earning",
}


def prepare_increment_row(raw: dict, db: Session, actor_entity: Optional[str]) -> dict:
    """Validate ONE bulk-increment row (salary-sheet-style, no DB writes).

    Columns: SAP Code (or Emp Code), Employee Name, the salary components (Basic, HRA,
    Medical, Special, CCA, LTA, Other Allowance) holding the NEW absolute values, plus
    Effective From + Reason. A blank Effective From → the row is SKIPPED (out['skip']).
    Returns either {'error': ...}, {'skip': True}, or a resolved increment ready for
    apply_increment (emp_code, name, effective_from ISO, reason, new_values, gross).
    """
    def g(key: str):
        for k, v in raw.items():
            if str(k).strip().lower() == key:
                return v.strip() if isinstance(v, str) else v
        return None

    ident = str(g("sap code") or g("sap_code") or g("emp code") or g("emp_code") or "").strip()
    # sap_code is what HR sees in the validation report (they work by SAP code, not
    # the internal emp_code). Default to the identifier they typed; overwrite with the
    # resolved employee's canonical SAP code below.
    out: dict = {"emp_code": ident, "sap_code": ident}
    if not ident:
        out["skip"] = True   # blank/legend row in the template — not a data row
        return out

    # Resolve identity → employee: try emp_code, then SAP code.
    emp = db.query(Employee).filter(Employee.emp_code == ident).first()
    if emp is None:
        emp = db.query(Employee).filter(Employee.sap_code == ident).first()
    if emp is None:
        out["error"] = f"employee '{ident}' not found"
        return out
    out["emp_code"] = emp.emp_code
    out["sap_code"] = emp.sap_code or ident   # canonical SAP code (fallback: typed value / emp_code)
    out["name"] = emp.name
    out["entity_id"] = emp.entity_id
    if actor_entity is not None and emp.entity_id != actor_entity:
        out["error"] = "employee is outside your entity"
        return out

    # Blank Effective From → not an increment; skip silently.
    ef_raw = g("effective from") or g("effective_from")
    if not str(ef_raw or "").strip():
        out["skip"] = True
        return out
    ef = _parse_inc_date(ef_raw)
    if ef is None:
        out["error"] = f"bad Effective From '{ef_raw}' (use DD-MM-YYYY)"
        return out
    if ef.day != 1:
        out["error"] = "Effective From must be the 1st of a month"
        return out
    out["effective_from"] = ef.isoformat()

    reason = (str(g("reason") or "increment").strip().lower() or "increment")
    if reason not in ("increment", "correction"):
        out["error"] = "Reason must be 'increment' or 'correction'"
        return out
    out["reason"] = reason

    # No structure yet (bulk-imported employees never got one) → the increment will
    # bootstrap a baseline from the employee's live salary columns at commit, so use
    # those columns as the "current" figures here instead of rejecting the row.
    active = get_active_structure(db, emp.emp_code)
    base = active if active is not None else emp
    if active is not None and ef <= active.effective_from:
        out["error"] = f"Effective From must be after the current structure start ({active.effective_from})"
        return out

    # Per-component NEW absolute values; blank cell = carry the current value forward.
    new_values: dict = {}
    for header_key, comp in _INC_COMPONENT_COLS.items():
        if comp in new_values:
            continue
        v = g(header_key)
        if v is None or str(v).strip() == "":
            continue
        try:
            new_values[comp] = Decimal(str(v).replace(",", "").replace("₹", "").strip())
        except (InvalidOperation, AttributeError, TypeError):
            out["error"] = f"bad {comp} value '{v}'"
            return out
        if new_values[comp] < 0:
            out["error"] = f"{comp} cannot be negative"
            return out

    if not new_values:
        out["error"] = "no salary values provided to change"
        return out

    merged = {c: _to_dec(getattr(base, c)) for c in _COMPONENTS}
    merged.update(new_values)
    out["new_values"] = {k: float(v) for k, v in new_values.items()}
    out["current_gross"] = float(sum(_to_dec(getattr(base, c)) for c in _STATUTORY))
    out["new_gross"] = float(sum(merged[c] for c in _STATUTORY))
    return out
