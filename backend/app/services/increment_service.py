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

from datetime import date, timedelta
from decimal import Decimal

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

    # 7. Recompute esic_applicable on the new statutory gross.
    statutory_gross = sum(resolved[c] for c in _STATUTORY)
    emp.esic_applicable = statutory_gross <= Decimal("21000")

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
