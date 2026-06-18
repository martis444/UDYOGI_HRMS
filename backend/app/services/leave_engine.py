"""
Leave accrual engine.

Workers (category='worker') never accrue leaves.
Staff on probation (is_on_probation=True) never accrue.
Probation ends automatically when present_days >= probation_days.
"""
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.employee import (
    AttendanceDaily, AuditLog, Employee, LeaveAccrualLog, LeaveBalance,
)

_MONTHLY_TAG_PREFIX = "MONTHLY_ACCRUAL:"


def check_and_end_probation(emp_code: str, db: Session) -> bool:
    """
    Count present days; if >= probation_days, close probation.
    Returns True if probation just ended.
    """
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp or not emp.is_on_probation:
        return False

    present_count = (
        db.query(AttendanceDaily)
        .filter(
            AttendanceDaily.emp_code == emp_code,
            AttendanceDaily.att_status.in_(["P"]),
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


def get_months_since_probation(emp_code: str, db: Session) -> int:
    """Return full calendar months elapsed since probation_end_date. 0 if still on probation."""
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp or emp.is_on_probation or not emp.probation_end_date:
        return 0
    today = date.today()
    end = emp.probation_end_date
    months = (today.year - end.year) * 12 + (today.month - end.month)
    return max(0, months)


def calculate_monthly_cl_sl(months_since_probation: int) -> tuple:
    """
    Returns (cl_credit, sl_credit) for the Nth month since probation end.

    Months 1-9  — alternating 2/1 CL, steady 1 SL:
      odd months  → 2 CL, 1 SL
      even months → 1 CL, 1 SL
    Months 10+  — 3 CL, 1 SL every month
    """
    if months_since_probation <= 0:
        return (0.0, 0.0)
    if months_since_probation <= 9:
        cl = 2.0 if months_since_probation % 2 == 1 else 1.0
        sl = 1.0
    else:
        cl = 3.0
        sl = 1.0
    return (cl, sl)


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


def run_monthly_accrual(emp_code: str, month: int, year: int, db: Session) -> str:
    """
    Credit leave for one employee for the given month/year.
    Idempotent — safe to call multiple times.

    Returns one of: 'accrued' | 'skipped_worker' | 'skipped_probation' | 'already_processed'
    Caller is responsible for db.commit().
    """
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee {emp_code} not found")

    # Rule 1: workers never get leaves
    if (emp.category or "staff") == "worker":
        return "skipped_worker"

    # Rule 2: auto-end probation if threshold reached, then re-check
    check_and_end_probation(emp_code, db)
    db.refresh(emp)

    if emp.is_on_probation:
        return "skipped_probation"

    # Idempotency: each month produces one accrual entry per leave_type tagged with MONTHLY_ACCRUAL:YYYY-MM
    tag = f"{_MONTHLY_TAG_PREFIX}{year}-{month:02d}"
    if (
        db.query(LeaveAccrualLog)
        .filter(
            LeaveAccrualLog.emp_code == emp_code,
            LeaveAccrualLog.reason == tag,
        )
        .first()
    ):
        return "already_processed"

    # Determine which month number this is since probation ended (drives CL/SL pattern)
    prior_cl_count = (
        db.query(LeaveAccrualLog)
        .filter(
            LeaveAccrualLog.emp_code == emp_code,
            LeaveAccrualLog.leave_type == "CL",
            LeaveAccrualLog.reason.like(f"{_MONTHLY_TAG_PREFIX}%"),
        )
        .count()
    )
    months_since = prior_cl_count + 1
    cl_credit, sl_credit = calculate_monthly_cl_sl(months_since)

    # Rule 5: PL only after 1 full year of service from DOJ
    today = date.today()
    service_years = ((today - emp.doj).days // 365) if emp.doj else 0
    pl_credit = round(14 / 12, 3) if service_years >= 1 else 0.0

    credited: list[str] = []

    for leave_type, amount in [("CL", cl_credit), ("SL", sl_credit), ("PL", pl_credit)]:
        if amount <= 0:
            continue
        lb = _get_or_create_balance(emp_code, leave_type, year, db)
        lb.entitlement = float(lb.entitlement or 0) + amount
        lb.accrued_ytd = float(lb.accrued_ytd or 0) + amount
        db.add(LeaveAccrualLog(
            emp_code=emp_code,
            leave_type=leave_type,
            accrual_date=today,
            days_credited=amount,
            reason=tag,
        ))
        credited.append(f"{leave_type}:{amount}")

    db.add(AuditLog(
        user_code="SYSTEM",
        action="LEAVE_ACCRUAL",
        table_name="leave_balances",
        record_id=emp_code,
        new_values={"month": month, "year": year, "credited": credited},
    ))

    return "accrued"


def encash_pl(emp_code: str, days: float, db: Session) -> dict:
    """
    Encash PL days for an employee.
    Eligibility: PL balance >= 28. daily_rate = basic / 26.
    Deducts from entitlement (reduces DB-generated balance) and updates encashed_ytd.
    Caller should NOT have an open transaction; this function commits.
    """
    if days < 1:
        raise HTTPException(status_code=400, detail="Minimum 1 day for encashment")

    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee {emp_code} not found")

    # Find most recent PL balance row (supports multi-year carry-forward)
    lb = (
        db.query(LeaveBalance)
        .filter(
            LeaveBalance.emp_code == emp_code,
            LeaveBalance.leave_type == "PL",
        )
        .order_by(LeaveBalance.year.desc())
        .first()
    )
    if not lb:
        raise HTTPException(status_code=400, detail="No PL balance found")

    # available = DB-generated balance (entitlement - used)
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

    # Deduct from entitlement so DB-generated balance reflects encashment
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
