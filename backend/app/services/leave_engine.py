"""
Leave engine (Session 15.3, revised Session 18).

Leave is CL / SL / PL only (EL retired in migration 010). Two different models:

  PL — cumulative, carries forward. Granted after the first DOJ anniversary;
       tb = completed_DOJ_years × policy[PL]; used is all-time. (Unchanged.)

  CL / SL (Session 18) — do NOT carry forward. They accrue monthly at
       policy/12 per *completed* calendar month, starting after the employee's
       confirmation_date (HR-set), and reset to 0 at the start of each financial
       year (FINANCIAL_YEAR_START_MONTH = 1 April). So within an FY:
         tb  = min(completed_confirmed_months × policy/12, policy)   (fractional, 2dp)
         used = CL/SL consumed within the current FY only
         alb  = max(tb - used, 0)

  ANNUAL_LEAVE = {CL: 10, SL: 7, PL: 14}   (config.settings.ANNUAL_LEAVE)

Everything is DERIVED on read (15.7 self-correcting), so the FY reset needs no
stored mutation — CL/SL are simply scoped to the current FY when resolved.

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


def _used_days(
    db: Session, emp_code: str, lt: str,
    start: date | None = None, end: date | None = None,
) -> float:
    """`used` for one bucket, DERIVED (15.7-style self-correcting) from the two
    authoritative consumption sources, optionally scoped to [start, end]:
      1. leave actually taken = attendance_daily rows with att_status cl/sl/pl
         (written by leave approval, 15.3) — Sundays already excluded.
      2. leave spent covering late-coming = the LATE_COVER ledger (15.4).
    CL/SL pass the current-FY window (no carry-forward); PL passes none (all-time).
    """
    code = _LEAVE_TO_ATT[lt]
    q = db.query(AttendanceDaily).filter(
        AttendanceDaily.emp_code == emp_code, AttendanceDaily.att_status == code,
    )
    if start is not None:
        q = q.filter(AttendanceDaily.att_date >= start)
    if end is not None:
        q = q.filter(AttendanceDaily.att_date <= end)
    used = float(q.count())

    lq = db.query(LeaveAccrualLog).filter(
        LeaveAccrualLog.emp_code == emp_code,
        LeaveAccrualLog.leave_type == lt,
        LeaveAccrualLog.reason.like("LATE_COVER:%"),
    )
    if start is not None:
        lq = lq.filter(LeaveAccrualLog.accrual_date >= start)
    if end is not None:
        lq = lq.filter(LeaveAccrualLog.accrual_date <= end)
    for log in lq.all():
        used += float(log.days_credited or 0)
    return used


def derived_used(db: Session, emp_code: str) -> dict[str, float]:
    """All-time used per bucket (kept for callers/back-compat)."""
    return {lt: _used_days(db, emp_code, lt) for lt in _BUCKETS}


def financial_year_window(as_of: date) -> tuple[date, date]:
    """(fy_start, fy_end) for the financial year containing `as_of`.
    FY starts on FINANCIAL_YEAR_START_MONTH (1 April for India)."""
    m = settings.FINANCIAL_YEAR_START_MONTH
    fy_start = date(as_of.year if as_of.month >= m else as_of.year - 1, m, 1)
    fy_end = date(fy_start.year + 1, m, 1) - timedelta(days=1)
    return fy_start, fy_end


def _confirmed_months_in_fy(
    confirmation: date | None, as_of: date, fy_start: date
) -> int:
    """Count complete calendar months within the FY whose last day is on/before
    `as_of` and for which the employee was already confirmed at the month's start.
    Accrual is in arrears — 'after each completed month'."""
    if confirmation is None or confirmation > as_of:
        return 0
    count = 0
    y, mo = fy_start.year, fy_start.month
    for _ in range(12):
        month_first = date(y, mo, 1)
        nxt = date(y + 1, 1, 1) if mo == 12 else date(y, mo + 1, 1)
        month_last = nxt - timedelta(days=1)
        if month_last <= as_of and confirmation <= month_first:
            count += 1
        y, mo = nxt.year, nxt.month
    return count


def accrued_cl_sl(confirmation: date | None, annual: float, as_of: date) -> float:
    """CL/SL accrued in the current FY: (annual/12) per completed confirmed month,
    capped at the annual quota. Resets each FY. Fractional, rounded to 2dp."""
    fy_start, _ = financial_year_window(as_of)
    months = _confirmed_months_in_fy(confirmation, as_of, fy_start)
    return round(min(months * (annual / 12.0), annual), 2)


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
      PL    : tb = completed_DOJ_years × policy (cumulative, carries forward);
              ulb = all-time used.
      CL/SL : tb = monthly accrual (policy/12 per completed confirmed month) within
              the current financial year, capped at the annual quota, reset each FY;
              ulb = used within the current FY only (no carry-forward).
      alb   : max(tb - ulb, 0). All 0 for workers.

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
    fy_start, fy_end = financial_year_window(as_of_date)

    out: dict = {}
    changed = False
    for lt in _BUCKETS:
        if is_worker:
            tb, ulb = 0.0, 0.0
        elif lt == "PL":
            # Cumulative: carries forward, granted after 1y DOJ; used is all-time.
            tb = round(years * policy.get("PL", 0.0), 2)
            ulb = round(_used_days(db, emp_code, "PL"), 2)
        else:
            # CL/SL: FY-scoped monthly accrual after confirmation; no carry-forward.
            tb = accrued_cl_sl(emp.confirmation_date, policy.get(lt, 0.0), as_of_date)
            ulb = round(_used_days(db, emp_code, lt, fy_start, fy_end), 2)
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
