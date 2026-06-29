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
_COMPONENTS = ("basic", "hra", "spl", "cca", "leave_travel", "other_earning")

# Components that count toward statutory gross (other_earning is excluded — paid but non-statutory).
_STATUTORY = ("basic", "hra", "spl", "cca", "leave_travel")


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

    # 2. Current active structure.
    active = get_active_structure(db, emp_code)
    if active is None:
        raise ValueError(f"No active salary structure found for {emp_code}")

    # 3. Cannot backdate before the current structure's start.
    if effective_from <= active.effective_from:
        raise ValueError(
            f"effective_from ({effective_from}) must be after the current "
            f"structure's effective_from ({active.effective_from})"
        )

    # 4. Validate reason.
    if reason not in ("increment", "correction"):
        raise ValueError("reason must be 'increment' or 'correction'")

    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if emp is None:
        raise ValueError(f"Employee {emp_code} not found")

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


def prepare_increment_row(raw: dict, db: Session, actor_entity: Optional[str]) -> dict:
    """Validate + resolve ONE bulk-increment row (no DB writes).

    Returns a dict carrying either an 'error' string, or the resolved increment
    (emp_code, name, effective_from ISO, reason, new_values, current/new gross)
    ready for apply_increment.
    """
    def g(key: str):
        for k, v in raw.items():
            if str(k).strip().lower() == key:
                return v.strip() if isinstance(v, str) else v
        return None

    emp_code = str(g("emp_code") or "").strip()
    mode = str(g("mode") or "").strip().lower()
    out: dict = {
        "emp_code": emp_code,
        "mode": mode,
        "value": g("value"),
        "reason": (str(g("reason") or "increment").strip().lower() or "increment"),
    }

    if not emp_code:
        out["error"] = "emp_code is required"
        return out
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if emp is None:
        out["error"] = f"employee {emp_code} not found"
        return out
    out["name"] = emp.name
    out["entity_id"] = emp.entity_id
    if actor_entity is not None and emp.entity_id != actor_entity:
        out["error"] = "employee is outside your entity"
        return out

    ef = _parse_inc_date(g("effective_from"))
    if ef is None:
        out["error"] = f"bad effective_from '{g('effective_from')}' (use YYYY-MM-DD)"
        return out
    if ef.day != 1:
        out["error"] = "effective_from must be the 1st of a month"
        return out
    out["effective_from"] = ef.isoformat()

    if out["reason"] not in ("increment", "correction"):
        out["error"] = "reason must be 'increment' or 'correction'"
        return out

    try:
        val = Decimal(str(g("value")).replace(",", "").replace("₹", "").strip())
    except (InvalidOperation, AttributeError, TypeError):
        out["error"] = f"bad value '{g('value')}'"
        return out
    if mode not in _VALID_MODES:
        out["error"] = f"unknown mode '{mode}' — use pct / flat / " + " / ".join(_ABS_FIELD)
        return out
    if mode in ("pct", "flat") and val <= 0:
        out["error"] = "value must be greater than 0"
        return out
    if val < 0:
        out["error"] = "value cannot be negative"
        return out

    active = get_active_structure(db, emp_code)
    if active is None:
        out["error"] = "no active salary structure to increment"
        return out
    if ef <= active.effective_from:
        out["error"] = (
            f"effective_from must be after the current structure start "
            f"({active.effective_from})"
        )
        return out

    try:
        new_values = resolve_increment(active, mode, val)
    except ValueError as e:
        out["error"] = str(e)
        return out

    merged = {c: _to_dec(getattr(active, c)) for c in _COMPONENTS}
    merged.update({k: _to_dec(v) for k, v in new_values.items()})
    out["new_values"] = {k: float(_to_dec(v)) for k, v in new_values.items()}
    out["current_gross"] = float(sum(_to_dec(getattr(active, c)) for c in _STATUTORY))
    out["new_gross"] = float(sum(merged[c] for c in _STATUTORY))
    return out
