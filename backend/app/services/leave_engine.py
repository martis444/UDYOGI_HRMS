"""
Leave engine — flat annual grant model (Session 15.3).

Leave is CL / SL / PL only (EL retired in migration 010). There is no monthly
accrual and no probation gate on leave: an employee simply has no leave balance
until their first DOJ anniversary (doj + 1 year), at which point a flat annual
quota is granted. On every later anniversary the unused balance is carried
forward and the fresh quota added on top, with `used` reset to 0.

  ANNUAL_LEAVE = {CL: 10, SL: 7, PL: 14}   (config.settings.ANNUAL_LEAVE)

Probation (3 months default, 6 max) is kept purely for confirmation — it no
longer starts or gates leave.

Workers (category='worker') never get leave.
"""
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.employee import (
    AttendanceDaily, AuditLog, Employee, LeaveAccrualLog, LeaveBalance,
    LeavePolicyConfig, LeaveRequest,
)

# leave_type (CL/SL/PL) -> attendance_daily.att_status code (paid, not LOP).
_LEAVE_TO_ATT = {"CL": "cl", "SL": "sl", "PL": "pl"}
_BUCKETS = ("CL", "SL", "PL")


# ---------------------------------------------------------------------------
# Single source of truth (15.7): entitlement is DERIVED (years × policy) and
# auto-materialized into leave_balances. Every consumer must call
# resolve_leave_balance — never read leave_balances.entitlement directly.
# ---------------------------------------------------------------------------

def completed_leave_years(doj: date | None, as_of: date) -> int:
    """Number of completed DOJ anniversaries on/before as_of (precise date math, not /365)."""
    if not doj or as_of < doj:
        return 0
    years = as_of.year - doj.year
    if (as_of.month, as_of.day) < (doj.month, doj.day):
        years -= 1
    return max(0, years)


def get_leave_policy(db: Session) -> dict[str, float]:
    """Policy amounts from the single leave_policy table (falls back to config)."""
    rows = db.query(LeavePolicyConfig).all()
    if rows:
        return {r.leave_type: float(r.annual_days or 0) for r in rows}
    return {k: float(v) for k, v in settings.ANNUAL_LEAVE.items()}


def _latest_row(db: Session, emp_code: str, lt: str) -> LeaveBalance | None:
    return (
        db.query(LeaveBalance)
        .filter(LeaveBalance.emp_code == emp_code, LeaveBalance.leave_type == lt)
        .order_by(LeaveBalance.year.desc())
        .first()
    )


def derived_used(db: Session, emp_code: str) -> dict[str, float]:
    """`used` is DERIVED (15.7-style self-correcting), from the two authoritative
    leave-consumption sources, so it can never drift from reality:
      1. leave actually taken  = attendance_daily rows with att_status cl/sl/pl
         (written by leave approval, 15.3) — Sundays already excluded.
      2. leave spent covering late-coming = the LATE_COVER ledger (15.4) in
         leave_accrual_log.
    """
    used = {"CL": 0.0, "SL": 0.0, "PL": 0.0}
    for code, lt in (("cl", "CL"), ("sl", "SL"), ("pl", "PL")):
        used[lt] += float(
            db.query(AttendanceDaily)
            .filter(AttendanceDaily.emp_code == emp_code, AttendanceDaily.att_status == code)
            .count()
        )
    for log in (
        db.query(LeaveAccrualLog)
        .filter(LeaveAccrualLog.emp_code == emp_code, LeaveAccrualLog.reason.like("LATE_COVER:%"))
        .all()
    ):
        if log.leave_type in used:
            used[log.leave_type] += float(log.days_credited or 0)
    return used


def reflect_all_approved_leaves(emp_code: str, db: Session) -> int:
    """Ensure every APPROVED leave_request is reflected onto the attendance sheet
    (idempotent). Backfills historical approvals that predate the reflection logic.
    Returns the number of requests processed."""
    reqs = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.emp_code == emp_code, LeaveRequest.status == "approved")
        .all()
    )
    for req in reqs:
        reflect_leave_on_attendance(req, db)
    return len(reqs)


def resolve_leave_balance(
    emp_code: str, as_of_date: date, db: Session, write_through: bool = True
) -> dict:
    """
    Canonical leave-balance resolver. Returns {cl,sl,pl: {tb, ulb, alb}} where:
      tb (entitlement) = completed_leave_years × policy amount  (0 for workers / pre-1yr)
      ulb (used)       = the stored cumulative `used` for that bucket
      alb (available)  = max(tb - ulb, 0)

    write_through=True keeps the stored entitlement column (and the generated
    `balance`) fresh and ensures a CL/SL/PL row exists — self-healing on read.
    It only flushes; the CALLER owns the commit.
    """
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee {emp_code} not found")

    years = completed_leave_years(emp.doj, as_of_date)
    is_worker = (emp.category or "staff") == "worker"
    policy = get_leave_policy(db)
    used_map = derived_used(db, emp_code)   # used is derived too (self-correcting)

    out: dict = {}
    changed = False
    for lt in _BUCKETS:
        tb = 0.0 if is_worker else round(years * policy.get(lt, 0.0), 2)
        ulb = round(used_map.get(lt, 0.0), 2)
        row = _latest_row(db, emp_code, lt)

        if write_through:
            if row is None:
                row = LeaveBalance(
                    emp_code=emp_code, leave_type=lt, year=as_of_date.year,
                    entitlement=Decimal(str(tb)), used=Decimal(str(ulb)),
                    carried_forward=Decimal("0"), accrued_ytd=Decimal("0"),
                    taken_ytd=Decimal("0"), encashed_ytd=Decimal("0"),
                )
                db.add(row); changed = True
            else:
                if float(row.entitlement or 0) != tb:
                    row.entitlement = Decimal(str(tb)); changed = True
                if float(row.used or 0) != ulb:
                    row.used = Decimal(str(ulb)); changed = True
            # keep taken_ytd (admin tracker display) in sync with derived used
            if row is not None and float(row.taken_ytd or 0) != ulb:
                row.taken_ytd = Decimal(str(ulb)); changed = True

        alb = max(round(tb - ulb, 2), 0.0)
        out[lt.lower()] = {"tb": tb, "ulb": ulb, "alb": alb}

    if write_through and changed:
        db.flush()
    return out


def ensure_leave_rows(emp_code: str, db: Session, as_of_date: date | None = None) -> None:
    """Ensure CL/SL/PL rows exist + entitlement is current. For employee create/DOJ change."""
    resolve_leave_balance(emp_code, as_of_date or date.today(), db, write_through=True)


def materialize_all_leave_balances(db: Session, as_of_date: date | None = None) -> int:
    """Write-through derived entitlement for every active employee. Idempotent.
    Used by the startup/daily refresh and the manual force-refresh endpoint."""
    as_of = as_of_date or date.today()
    n = 0
    for emp in db.query(Employee).filter(Employee.status == "active").all():
        try:
            # Reflect approved leaves onto the attendance sheet (backfills historical
            # approvals), then derive entitlement + used. Both self-correcting.
            reflect_all_approved_leaves(emp.emp_code, db)
            resolve_leave_balance(emp.emp_code, as_of, db, write_through=True)
            n += 1
        except Exception:  # noqa: BLE001
            db.rollback()
    db.commit()
    return n


def check_and_end_probation(emp_code: str, db: Session) -> bool:
    """
    Count present days; if >= probation_days, close probation. Confirmation only —
    no longer coupled to leave. Returns True if probation just ended.
    """
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp or not emp.is_on_probation:
        return False

    present_count = (
        db.query(AttendanceDaily)
        .filter(
            AttendanceDaily.emp_code == emp_code,
            AttendanceDaily.att_status == "present",
        )
        .count()
    )

    if present_count >= (emp.probation_days or 90):
        today = date.today()
        emp.is_on_probation = False
        emp.probation_end_date = today
        db.add(AuditLog(
            user_code="SYSTEM",
            action="PROBATION_ENDED",
            table_name="employees",
            record_id=emp_code,
            new_values={
                "probation_end_date": today.isoformat(),
                "present_days": present_count,
                "trigger": "auto",
            },
        ))
        db.flush()
        return True
    return False


def _get_or_create_balance(
    emp_code: str, leave_type: str, year: int, db: Session
) -> LeaveBalance:
    lb = (
        db.query(LeaveBalance)
        .filter(
            LeaveBalance.emp_code == emp_code,
            LeaveBalance.leave_type == leave_type,
            LeaveBalance.year == year,
        )
        .first()
    )
    if not lb:
        lb = LeaveBalance(
            emp_code=emp_code,
            leave_type=leave_type,
            year=year,
            entitlement=Decimal("0"),
            used=Decimal("0"),
            # balance is GENERATED ALWAYS AS (entitlement - used) — never set explicitly
            carried_forward=Decimal("0"),
            accrued_ytd=Decimal("0"),
            taken_ytd=Decimal("0"),
            encashed_ytd=Decimal("0"),
        )
        db.add(lb)
        db.flush()
    return lb


# ---------------------------------------------------------------------------
# Manual "force refresh" (demoted from the 15.4 grant — entitlement is now
# derived + auto-materialized; this just runs the write-through for all/one emp).
# ---------------------------------------------------------------------------

def run_grants(as_of_date: date, db: Session, entity_id: str | None = None) -> dict:
    """Force a resolve+write-through over active employees (optionally one entity).
    No longer the only path — reads + the daily job keep balances current too."""
    q = db.query(Employee).filter(Employee.status == "active")
    if entity_id:
        q = q.filter(Employee.entity_id == entity_id)

    refreshed = 0
    errors: list[dict] = []
    for emp in q.all():
        try:
            resolve_leave_balance(emp.emp_code, as_of_date, db, write_through=True)
            refreshed += 1
        except Exception as exc:  # noqa: BLE001
            errors.append({"emp_code": emp.emp_code, "error": str(exc)})
    db.commit()
    return {"refreshed": refreshed, "errors": errors}


# ---------------------------------------------------------------------------
# Leave -> attendance reflection (authoritative paid-day write)
# ---------------------------------------------------------------------------

def reflect_leave_on_attendance(req, db: Session) -> int:
    """
    Write every working day of an approved leave into attendance_daily with the
    leave's att_status (cl/sl/pl) so the payroll engine counts it as PAID, not LOP.

    The payroll engine attributes attendance to a pay period by the 26th cutoff
    (CYCLE_CUTOFF_DAY), so a leave day on/after the 26th naturally lands in the
    next month's payroll run, and a span across the 26th splits across two runs —
    no period maths needed here, just write the real calendar dates.

    Idempotent per (emp_code, att_date): re-running upserts the same rows.
    Sundays are left as weekly-off (not overwritten). Returns days written.
    """
    status = _LEAVE_TO_ATT.get(req.leave_type)
    if status is None:
        return 0
    emp = db.query(Employee).filter(Employee.emp_code == req.emp_code).first()

    written = 0
    d = req.from_date
    while d <= req.to_date:
        if d.weekday() != 6:  # 6 = Sunday (weekly off)
            existing = (
                db.query(AttendanceDaily)
                .filter(AttendanceDaily.emp_code == req.emp_code, AttendanceDaily.att_date == d)
                .first()
            )
            if existing:
                existing.att_status = status
                existing.source = "leave"
            else:
                db.add(AttendanceDaily(
                    emp_code=req.emp_code,
                    att_date=d,
                    att_status=status,
                    source="leave",
                    location_id=emp.location_id if emp else None,
                    shift_id=emp.shift_id if emp else None,
                ))
            written += 1
        d += timedelta(days=1)
    db.flush()
    return written


def encash_pl(emp_code: str, days: float, db: Session) -> dict:
    """
    Encash PL days for an employee. Eligibility: PL balance >= 28. daily_rate =
    basic / 26. Deducts from entitlement (reduces DB-generated balance) and
    updates encashed_ytd. Commits.
    """
    if days < 1:
        raise HTTPException(status_code=400, detail="Minimum 1 day for encashment")

    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee {emp_code} not found")

    lb = (
        db.query(LeaveBalance)
        .filter(LeaveBalance.emp_code == emp_code, LeaveBalance.leave_type == "PL")
        .order_by(LeaveBalance.year.desc())
        .first()
    )
    if not lb:
        raise HTTPException(status_code=400, detail="No PL balance found")

    available = float(lb.entitlement or 0) - float(lb.used or 0)
    if available < 28:
        raise HTTPException(
            status_code=400,
            detail=f"PL balance ({available:.2f}) must be >= 28 to be eligible for encashment",
        )
    if days > available:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot encash {days} days — available balance is {available:.2f}",
        )

    daily_rate = float(emp.basic or 0) / 26
    encashment_amount = round(daily_rate * days, 2)
    remaining_balance = available - days

    lb.entitlement = float(lb.entitlement or 0) - days
    lb.encashed_ytd = float(lb.encashed_ytd or 0) + days

    db.add(LeaveAccrualLog(
        emp_code=emp_code,
        leave_type="PL",
        accrual_date=date.today(),
        days_credited=-days,
        reason="ENCASHMENT",
    ))
    db.add(AuditLog(
        user_code=emp_code,
        action="LEAVE_ENCASHMENT",
        table_name="leave_balances",
        record_id=emp_code,
        new_values={
            "days_encashed": days,
            "encashment_amount": encashment_amount,
            "remaining_balance": remaining_balance,
            "daily_rate": daily_rate,
        },
    ))

    db.commit()
    return {
        "encashment_amount": encashment_amount,
        "remaining_balance": remaining_balance,
        "days_encashed": days,
        "daily_rate": round(daily_rate, 4),
    }
