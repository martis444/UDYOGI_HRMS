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
)

# leave_type (CL/SL/PL) -> attendance_daily.att_status code (paid, not LOP).
_LEAVE_TO_ATT = {"CL": "cl", "SL": "sl", "PL": "pl"}


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
# Flat annual grant
# ---------------------------------------------------------------------------

def grant_annual_leave(emp_code: str, as_of_date: date, db: Session) -> str:
    """
    Grant the flat annual leave quota for an employee, if a DOJ anniversary has
    been reached as of `as_of_date`. Idempotent per anniversary (year_index).

    Returns one of:
      'granted' | 'already_granted' | 'skipped_worker'
      | 'skipped_no_doj' | 'skipped_pre_anniversary'

    Caller is responsible for db.commit().
    """
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee {emp_code} not found")

    if (emp.category or "staff") == "worker":
        return "skipped_worker"
    if not emp.doj:
        return "skipped_no_doj"

    # year_index = completed years of service as of as_of_date. <1 → no balance yet.
    year_index = (as_of_date - emp.doj).days // 365
    if year_index < 1:
        return "skipped_pre_anniversary"

    tag = f"ANNUAL_GRANT:{emp_code}:{year_index}"
    if (
        db.query(LeaveAccrualLog)
        .filter(LeaveAccrualLog.emp_code == emp_code, LeaveAccrualLog.reason == tag)
        .first()
    ):
        return "already_granted"

    store_year = as_of_date.year
    granted: list[str] = []

    for lt, quota in settings.ANNUAL_LEAVE.items():
        # Carry forward the unused balance from the most recent prior leave-year.
        carried = 0.0
        if year_index > 1:
            prior = (
                db.query(LeaveBalance)
                .filter(
                    LeaveBalance.emp_code == emp_code,
                    LeaveBalance.leave_type == lt,
                    LeaveBalance.year < store_year,
                )
                .order_by(LeaveBalance.year.desc())
                .first()
            )
            if prior:
                carried = max(0.0, float(prior.entitlement or 0) - float(prior.used or 0))

        lb = _get_or_create_balance(emp_code, lt, store_year, db)
        lb.entitlement = carried + float(quota)
        lb.used = 0
        lb.carried_forward = carried
        lb.accrued_ytd = float(quota)

        db.add(LeaveAccrualLog(
            emp_code=emp_code,
            leave_type=lt,
            accrual_date=as_of_date,
            days_credited=float(quota),
            reason=tag,
        ))
        granted.append(f"{lt}:{carried + float(quota)} (cf {carried})")

    db.add(AuditLog(
        user_code="SYSTEM",
        action="ANNUAL_GRANT",
        table_name="leave_balances",
        record_id=emp_code,
        new_values={"year_index": year_index, "store_year": store_year, "granted": granted},
    ))
    return "granted"


def run_grants(as_of_date: date, db: Session, entity_id: str | None = None) -> dict:
    """Batch grant over all active employees past their first anniversary."""
    q = db.query(Employee).filter(Employee.status == "active")
    if entity_id:
        q = q.filter(Employee.entity_id == entity_id)

    counters = {
        "granted": 0, "already_granted": 0, "skipped_worker": 0,
        "skipped_no_doj": 0, "skipped_pre_anniversary": 0,
    }
    errors: list[dict] = []
    for emp in q.all():
        try:
            result = grant_annual_leave(emp.emp_code, as_of_date, db)
            db.flush()
            counters[result] = counters.get(result, 0) + 1
        except HTTPException as exc:
            errors.append({"emp_code": emp.emp_code, "error": exc.detail})
        except Exception as exc:  # noqa: BLE001
            errors.append({"emp_code": emp.emp_code, "error": str(exc)})

    return {**counters, "errors": errors}


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
