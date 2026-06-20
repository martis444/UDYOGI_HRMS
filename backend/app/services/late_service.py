"""
Late-coming penalty (Session 15.4).

Every LATE_DAYS_PER_ABSENT (3) 'late' attendance days in a pay period count as one
absent-equivalent. Each absent-equivalent is covered first from the HIGHEST of the
employee's CL / SL / PL leave balance (spilling to the next-highest); whatever leave
cannot cover is charged as LD = uncovered_days * monthly_gross / PER_DAY_DIVISOR.

Leave coverage is reconciled idempotently per pay period via a LATE_COVER ledger in
leave_accrual_log, so reprocessing a month never double-debits leave (mirrors the
loan 'applied' reconcile pattern — recompute the target, apply only the delta).

The pay period uses the 26th cutoff cycle (same window as payroll_engine).
"""
from datetime import date
from math import floor

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.employee import AttendanceDaily, LeaveAccrualLog, LeaveBalance
from app.services.leave_engine import resolve_leave_balance

_BUCKETS = ("CL", "SL", "PL")


def _period_window(year: int, month: int) -> tuple[date, date]:
    cutoff = settings.CYCLE_CUTOFF_DAY
    start = date(year - 1, 12, cutoff) if month == 1 else date(year, month - 1, cutoff)
    end = date(year, month, cutoff - 1)
    return start, end


def _cover_tag(emp_code: str, year: int, month: int) -> str:
    return f"LATE_COVER:{emp_code}:{year}-{month:02d}"


def _latest_balance(db: Session, emp_code: str, lt: str):
    return (
        db.query(LeaveBalance)
        .filter(LeaveBalance.emp_code == emp_code, LeaveBalance.leave_type == lt)
        .order_by(LeaveBalance.year.desc())
        .first()
    )


def compute_late_effects(
    emp_code: str,
    year: int,
    month: int,
    db: Session,
    monthly_gross: float,
    absent_override: float | None = None,
    ld_override: float | None = None,
) -> dict:
    """
    Resolve late-coming effects for one employee/period and reconcile the leave
    coverage. Caller commits. Returns:
      {late_days, absent_from_late, covered_breakdown, uncovered_days, ld}

    absent_override / ld_override (admin override): when given, that value is used
    instead of the rule, but leave coverage is still reconciled to absent_from_late.
    """
    start, end = _period_window(year, month)
    late_days = (
        db.query(AttendanceDaily)
        .filter(
            AttendanceDaily.emp_code == emp_code,
            AttendanceDaily.att_status == "late",
            AttendanceDaily.att_date >= start,
            AttendanceDaily.att_date <= end,
        )
        .count()
    )

    if absent_override is not None:
        absent_from_late = float(absent_override)
    else:
        absent_from_late = float(floor(late_days / settings.LATE_DAYS_PER_ABSENT))

    tag = _cover_tag(emp_code, year, month)

    # What this period has already debited from each bucket (the cover ledger).
    prior: dict[str, float] = {}
    for log in (
        db.query(LeaveAccrualLog)
        .filter(LeaveAccrualLog.emp_code == emp_code, LeaveAccrualLog.reason == tag)
        .all()
    ):
        prior[log.leave_type] = prior.get(log.leave_type, 0.0) + float(log.days_credited or 0)

    # Available to cover = derived available (single source of truth) + this
    # period's prior cover (un-apply it so the recompute is stable / idempotent).
    # resolve also ensures the CL/SL/PL rows exist + entitlement is fresh.
    resolved = resolve_leave_balance(emp_code, end, db, write_through=True)
    bal_rows = {lt: _latest_balance(db, emp_code, lt) for lt in _BUCKETS}
    available: dict[str, float] = {}
    for lt in _BUCKETS:
        alb = resolved[lt.lower()]["alb"]  # = tb - used (used incl. prior cover)
        available[lt] = max(0.0, alb + prior.get(lt, 0.0))

    # Greedy cover: highest available bucket first, spill to next-highest.
    remaining = absent_from_late
    desired = {lt: 0.0 for lt in _BUCKETS}
    for lt in sorted(_BUCKETS, key=lambda b: available[b], reverse=True):
        if remaining <= 0:
            break
        take = min(available[lt], remaining)
        if take > 0:
            desired[lt] = take
            remaining -= take
    uncovered_days = round(max(0.0, remaining), 2)

    # Apply only the delta to leave_balances.used, then rewrite the cover ledger.
    for lt in _BUCKETS:
        delta = desired[lt] - prior.get(lt, 0.0)
        if delta and bal_rows[lt] is not None:
            bal_rows[lt].used = float(bal_rows[lt].used or 0) + delta

    db.query(LeaveAccrualLog).filter(
        LeaveAccrualLog.emp_code == emp_code, LeaveAccrualLog.reason == tag
    ).delete()
    for lt in _BUCKETS:
        if desired[lt] > 0:
            db.add(LeaveAccrualLog(
                emp_code=emp_code,
                leave_type=lt,
                accrual_date=date(year, month, 1),
                days_credited=desired[lt],
                reason=tag,
            ))
    db.flush()

    if ld_override is not None:
        ld = round(float(ld_override), 2)
    else:
        ld = round(uncovered_days * float(monthly_gross) / settings.PER_DAY_DIVISOR, 2)

    return {
        "late_days": late_days,
        "absent_from_late": absent_from_late,
        "covered_breakdown": {lt: desired[lt] for lt in _BUCKETS if desired[lt] > 0},
        "uncovered_days": uncovered_days,
        "ld": ld,
    }
