"""
Loan / advance EMI engine.

Invariant: loans.outstanding = principal - SUM(actual_emi for applied schedule rows).
`applied` is a boolean per (loan, year, month), so reprocessing a month never
double-counts — recompute_outstanding always rebuilds the balance from the ledger.

Period model: a loan started in payroll month (sy, sm) covers payroll months
(sy, sm) .. +tenure-1 (month-ordinal), while status='active'. Keyed to the
(year, month) the engine processes (one calendar-month period per payroll run).
"""

import calendar
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.employee import AuditLog, Loan, LoanEmiSchedule, PayrollMonth

ZERO = Decimal("0")


def _ord(y: int, m: int) -> int:
    return y * 12 + (m - 1)


def _add_months(d: date, n: int) -> date:
    o = _ord(d.year, d.month) + n
    y, m = o // 12, o % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _dec(v) -> Decimal:
    return Decimal(str(v)) if v is not None else ZERO


def _covers(loan: Loan, year: int, month: int) -> bool:
    if loan.status != "active":
        return False
    delta = _ord(year, month) - _ord(loan.start_date.year, loan.start_date.month)
    return 0 <= delta < loan.tenure_months


def _applied_sum(db: Session, loan_id: int, exclude: tuple | None = None) -> Decimal:
    rows = (
        db.query(LoanEmiSchedule)
        .filter(LoanEmiSchedule.loan_id == loan_id, LoanEmiSchedule.applied == True)  # noqa: E712
        .all()
    )
    total = ZERO
    for r in rows:
        if exclude and (r.year, r.month) == exclude:
            continue
        total += _dec(r.actual_emi)
    return total


def _audit(db, actor, action, loan_id, old=None, new=None):
    db.add(AuditLog(
        user_code=actor, action=action, table_name="loans",
        record_id=str(loan_id), old_values=old, new_values=new,
    ))


# ---------------------------------------------------------------------------

def create_loan(emp_code, loan_type, principal, emi, tenure_months, start_date,
                remarks, actor, db: Session) -> Loan:
    principal = _dec(principal)
    emi = _dec(emi)
    end_date = _add_months(start_date, tenure_months - 1)
    loan = Loan(
        emp_code=emp_code, loan_type=loan_type or "loan", principal=principal,
        emi=emi, tenure_months=tenure_months, start_date=start_date,
        end_date=end_date, outstanding=principal, status="active",
        remarks=remarks, created_by=actor,
    )
    db.add(loan)
    db.flush()
    _audit(db, actor, "LOAN_CREATE", loan.id, new={
        "emp_code": emp_code, "loan_type": loan.loan_type, "principal": float(principal),
        "emi": float(emi), "tenure_months": tenure_months,
        "start_date": str(start_date), "end_date": str(end_date),
    })
    return loan


def closing_balance_as_of(emp_code: str, year: int, month: int, db: Session) -> Decimal:
    """Total loan outstanding for an employee at the END of payroll month (year, month).
    Per loan: principal minus all APPLIED EMIs in periods up to and including this month;
    summed across the employee's loans that had already started by then. Loans starting
    later (or already fully paid) contribute 0. For the salary sheet's Loan Closing Balance.
    """
    target = _ord(year, month)
    loans = db.query(Loan).filter(Loan.emp_code == emp_code).all()
    total = ZERO
    for loan in loans:
        if _ord(loan.start_date.year, loan.start_date.month) > target:
            continue  # loan starts after this month — not yet on the books
        applied = (
            db.query(LoanEmiSchedule)
            .filter(LoanEmiSchedule.loan_id == loan.id, LoanEmiSchedule.applied == True)  # noqa: E712
            .all()
        )
        paid = sum((_dec(r.actual_emi) for r in applied if _ord(r.year, r.month) <= target), ZERO)
        bal = _dec(loan.principal) - paid
        if bal > 0:
            total += bal
    return total


def recompute_outstanding(loan_id: int, db: Session) -> Decimal:
    """Rebuild outstanding from the ledger (principal - applied). Closes at 0."""
    loan = db.get(Loan, loan_id)
    out = _dec(loan.principal) - _applied_sum(db, loan_id)
    if out < 0:
        out = ZERO
    loan.outstanding = out
    if out <= 0 and loan.status == "active":
        loan.status = "closed"
    return out


def ensure_schedule_row(loan: Loan, year: int, month: int, db: Session) -> LoanEmiSchedule:
    """Upsert a schedule row. scheduled = min(emi, remaining-before-this-month).
    Leaves an existing override's actual_emi untouched."""
    remaining = _dec(loan.principal) - _applied_sum(db, loan.id, exclude=(year, month))
    if remaining < 0:
        remaining = ZERO
    scheduled = min(_dec(loan.emi), remaining)

    row = (
        db.query(LoanEmiSchedule)
        .filter_by(loan_id=loan.id, year=year, month=month)
        .first()
    )
    if row is None:
        row = LoanEmiSchedule(
            loan_id=loan.id, emp_code=loan.emp_code, year=year, month=month,
            scheduled_emi=scheduled, actual_emi=scheduled,
            is_overridden=False, applied=False,
        )
        db.add(row)
        db.flush()
    elif not row.is_overridden and not row.applied:
        row.scheduled_emi = scheduled
        row.actual_emi = scheduled
    return row


def get_emi_for_period(emp_code, year, month, db: Session) -> Decimal:
    """Pure read: what would be deducted this period (override if set, else capped emi)."""
    total = ZERO
    loans = db.query(Loan).filter(Loan.emp_code == emp_code, Loan.status == "active").all()
    for loan in loans:
        if not _covers(loan, year, month):
            continue
        row = db.query(LoanEmiSchedule).filter_by(loan_id=loan.id, year=year, month=month).first()
        if row is not None:
            total += _dec(row.actual_emi)
        else:
            total += min(_dec(loan.emi), _dec(loan.outstanding))
    return total


def set_month_override(loan_id, year, month, new_emi, reason, actor, db: Session) -> LoanEmiSchedule:
    """HR sets actual_emi for one month (0 to skip, or reduced). Blocks locked months."""
    loan = db.get(Loan, loan_id)
    if loan is None:
        raise ValueError("Loan not found")

    pm = db.query(PayrollMonth).filter_by(emp_code=loan.emp_code, year=year, month=month).first()
    if pm is not None and pm.status == "locked":
        raise ValueError("Cannot override a locked payroll month")

    new_emi = _dec(new_emi)
    if new_emi < 0:
        raise ValueError("EMI cannot be negative")
    remaining = _dec(loan.principal) - _applied_sum(db, loan_id, exclude=(year, month))
    if remaining < 0:
        remaining = ZERO
    if new_emi > remaining:
        raise ValueError(f"EMI {new_emi} exceeds outstanding {remaining}")

    row = ensure_schedule_row(loan, year, month, db)
    old = _dec(row.actual_emi)
    row.actual_emi = new_emi
    row.is_overridden = True
    row.override_reason = reason
    row.overridden_by = actor
    db.flush()
    if row.applied:                       # already consumed → rebuild balance
        recompute_outstanding(loan_id, db)
    _audit(db, actor, "LOAN_EMI_OVERRIDE", loan_id, old={"actual_emi": float(old)},
           new={"year": year, "month": month, "actual_emi": float(new_emi), "reason": reason})
    return row


def apply_emi_on_payroll(emp_code, year, month, db: Session) -> Decimal:
    """Called by the payroll engine while building a month. Returns total EMI to deduct.
    Idempotent: an already-applied period is not decremented again."""
    total = ZERO
    loans = db.query(Loan).filter(Loan.emp_code == emp_code, Loan.status == "active").all()
    for loan in loans:
        if not _covers(loan, year, month):
            continue
        row = ensure_schedule_row(loan, year, month, db)
        if not row.applied:
            row.applied = True
            db.flush()
            recompute_outstanding(loan.id, db)
            _audit(db, "system", "LOAN_EMI_APPLIED", loan.id,
                   new={"year": year, "month": month, "actual_emi": float(_dec(row.actual_emi))})
        total += _dec(row.actual_emi)
    return total
