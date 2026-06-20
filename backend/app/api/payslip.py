from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.employee import (
    AuditLog, Department, Employee, Entity, LeaveBalance, Location, PayrollMonth, User,
)
from app.services.payroll_engine import compute_payroll, process_payroll_month
from app.services.pdf_generator import generate_pdf, num_to_words
from app.services.salary_resolver import get_structure_for_period

router = APIRouter()
# Mounted at /api/payroll in main.py — payroll operations console (status/lock/unlock).
payroll_router = APIRouter()

_MONTH_NAMES = {
    1: "January", 2: "February", 3: "March", 4: "April",
    5: "May", 6: "June", 7: "July", 8: "August",
    9: "September", 10: "October", 11: "November", 12: "December",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pgp_decrypt(db: Session, ciphertext: Optional[bytes]) -> Optional[str]:
    if ciphertext is None:
        return None
    return db.execute(
        select(func.pgp_sym_decrypt(ciphertext, settings.ENCRYPTION_KEY))
    ).scalar()


def _mask_account(account: Optional[str]) -> Optional[str]:
    if not account:
        return None
    visible = account[-4:] if len(account) >= 4 else account
    return "X" * (len(account) - len(visible)) + visible


def _assert_access(current_user: User, emp_code: str, db: Session) -> None:
    """Raise 403 if current_user has no access to the target employee's payslip."""
    if current_user.role == "super_admin":
        return
    if current_user.role == "employee" and current_user.emp_code != emp_code:
        raise HTTPException(status_code=403, detail="Access denied")
    # hr / manager / entity_admin must be in the same entity
    target = db.query(Employee.entity_id).filter(Employee.emp_code == emp_code).scalar()
    if not target:
        raise HTTPException(status_code=404, detail=f"Employee {emp_code} not found")
    my_entity = db.query(Employee.entity_id).filter(Employee.emp_code == current_user.emp_code).scalar()
    if target != my_entity:
        raise HTTPException(status_code=403, detail="Access denied")


def _build_response(pm: PayrollMonth, db: Session) -> dict[str, Any]:
    """Build the full payslip JSON payload from a PayrollMonth row."""
    emp = db.query(Employee).filter(Employee.emp_code == pm.emp_code).first()
    loc = db.query(Location).filter(Location.id == emp.location_id).first() if emp else None
    ent = db.query(Entity).filter(Entity.id == emp.entity_id).first() if emp else None
    dept = (
        db.query(Department).filter(Department.id == emp.department_id).first()
        if (emp and emp.department_id) else None
    )
    lb_rows = (
        db.query(LeaveBalance)
        .filter(LeaveBalance.emp_code == pm.emp_code, LeaveBalance.year == pm.year)
        .all()
    )
    leave_balances = {lb.leave_type: float(lb.balance or 0) for lb in lb_rows}

    # Structured CL/SL/PL leave block — TB (entitlement) / ULB (used) / ALB (balance).
    # Missing buckets default to 0/0/0.
    _lb_by_type = {lb.leave_type: lb for lb in lb_rows}

    def _leave_bucket(lt: str) -> dict[str, float]:
        lb = _lb_by_type.get(lt)
        return {
            "tb":  float(lb.entitlement or 0) if lb else 0.0,
            "ulb": float(lb.used or 0) if lb else 0.0,
            "alb": float(lb.balance or 0) if lb else 0.0,
        }

    leave = {"cl": _leave_bucket("CL"), "sl": _leave_bucket("SL"), "pl": _leave_bucket("PL")}

    # Effective-from of the salary structure that applied during this period.
    struct = get_structure_for_period(db, pm.emp_code, pm.year, pm.month)
    eff = struct.effective_from if struct else None
    salary_effective_from = eff.isoformat() if eff else None
    salary_effective_from_display = eff.strftime("%d-%b-%Y") if eff else None

    bank_acc_raw    = _pgp_decrypt(db, emp.bank_acc_enc) if emp else None
    bank_acc_masked = _mask_account(bank_acc_raw)

    # /30 proration factor (15.1) — pay_days = PER_DAY_DIVISOR - LOP_days.
    # 1.0 when no attendance (pay_days = full divisor). Factor never touches deductions.
    divisor      = settings.PER_DAY_DIVISOR
    pay_days_val = pm.pay_days
    factor = (
        min(1.0, float(pay_days_val) / divisor)
        if (pay_days_val is not None and divisor > 0)
        else 1.0
    )

    basic_r = float(pm.basic or 0)
    hra_r   = float(pm.hra or 0)
    spl_r   = float(pm.spl or 0)
    cca_r   = float(pm.cca or 0)
    lt_r    = float(pm.leave_travel or 0)
    oa      = round(float(pm.other_allowance or 0))   # other_allowance is never prorated

    basic_amt = round(basic_r * factor)
    hra_amt   = round(hra_r   * factor)
    spl_amt   = round(spl_r   * factor)
    cca_amt   = round(cca_r   * factor)
    lt_amt    = round(lt_r    * factor)

    gross_rate     = int(basic_r + hra_r + spl_r + cca_r + lt_r)
    total_earnings = basic_amt + hra_amt + spl_amt + cca_amt + lt_amt + oa

    pf_val   = int(float(pm.pf_emp or 0))
    esic_val = int(float(pm.esic_emp or 0))
    pt_val   = int(float(pm.pt or 0))
    loan_val = int(float(pm.loan_emi or 0))
    ld_val   = int(round(float(pm.ld or 0)))   # Late Deduction (15.4)
    oth_ded  = int(float(pm.other_deduction or 0))
    total_ded      = pf_val + esic_val + pt_val + loan_val + ld_val + oth_ded
    net_pay_display = total_earnings - total_ded

    return {
        # identity
        "payroll_id": pm.id,
        "emp_code":   pm.emp_code,
        "year":       pm.year,
        "month":      pm.month,
        "month_name": _MONTH_NAMES.get(pm.month, ""),
        "month_year": f"{_MONTH_NAMES.get(pm.month, '').upper()} - {pm.year}",
        # full monthly rates (for legacy callers / stats bar)
        "basic":           basic_r,
        "hra":             hra_r,
        "spl":             spl_r,
        "cca":             cca_r,
        "leave_travel":    lt_r,
        "other_allowance": oa,
        "gross":           gross_rate,
        # prorated earning rate/amount pairs (for payslip table)
        "basic_rate":     int(basic_r),
        "basic_amount":   basic_amt,
        "hra_rate":       int(hra_r),
        "hra_amount":     hra_amt,
        "spl_rate":       int(spl_r),
        "spl_amount":     spl_amt,
        "cca_rate":       int(cca_r),
        "cca_amount":     cca_amt,
        "lt_rate":        int(lt_r),
        "lt_amount":      lt_amt,
        "gross_rate":     gross_rate,
        "total_earnings": total_earnings,
        # deductions (never prorated)
        "pf_emp":          pf_val,
        "pf_ern":          int(float(pm.pf_ern or 0)),
        "esic_emp":        esic_val,
        "esic_ern":        int(float(pm.esic_ern or 0)),
        "pt":              pt_val,
        "loan_emi":        loan_val,
        "ld":              ld_val,   # Late Deduction (15.4)
        "other_deduction": oth_ded,
        "total_deduction": total_ded,
        "net_pay":         net_pay_display,
        # attendance
        "total_days": pm.total_days,
        "pay_days":   pm.pay_days,
        "days_p":     pm.days_p,
        "days_a":     pm.days_a,
        "days_wo":    pm.days_wo,
        "days_cl":    pm.days_cl,
        "days_pl":    pm.days_pl,
        "days_sl":    pm.days_sl,
        "days_h":     pm.days_h,
        "days_lwp":   pm.days_lwp,
        "late_days":        int(pm.late_days or 0),
        "absent_from_late": float(pm.absent_from_late or 0),
        "ot_hours":   float(pm.ot_hours or 0),
        "status":     pm.status,
        # employee / entity info
        "name":            emp.name if emp else "",
        "designation":     emp.designation if emp else None,
        "department":      dept.name if dept else None,
        "entity_id":       emp.entity_id if emp else None,
        "entity_name":     ent.name if ent else "",
        "entity_address":  ent.address if ent else None,
        "location_city":   loc.city if loc else "",
        "bank_acc_masked": bank_acc_masked,
        "pf_number":       emp.pf_number if emp else None,
        "uan_no":          emp.uan if emp else None,
        "esi_no":          emp.esic_no if emp else None,
        "leave_balances":  leave_balances,
        "leave":           leave,   # {cl,sl,pl} each {tb,ulb,alb}
        "salary_effective_from": salary_effective_from,
        "salary_effective_from_display": salary_effective_from_display,
        # derived
        "amount_in_words": num_to_words(net_pay_display),
        "generated_at":    pm.generated_at.isoformat() if pm.generated_at else None,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/data")
def get_payslip_data(
    emp_code: str = Query(...),
    year:     int = Query(...),
    month:    int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _assert_access(current_user, emp_code, db)

    pm = (
        db.query(PayrollMonth)
        .filter(
            PayrollMonth.emp_code == emp_code,
            PayrollMonth.year     == year,
            PayrollMonth.month    == month,
        )
        .first()
    )

    # Snapshots are frozen only AFTER locking (CLAUDE.md rules 5 & 6).
    # Any unlocked row is recomputed from current salary/attendance so an
    # edited salary is reflected immediately. Locked rows stay untouched.
    if pm is None or pm.status != "locked":
        pm = process_payroll_month(emp_code, year, month, db, generated_by=current_user.emp_code)

    return _build_response(pm, db)


@router.get("/pdf")
def get_payslip_pdf(
    emp_code: str = Query(...),
    year:     int = Query(...),
    month:    int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _assert_access(current_user, emp_code, db)

    pm = (
        db.query(PayrollMonth)
        .filter(
            PayrollMonth.emp_code == emp_code,
            PayrollMonth.year     == year,
            PayrollMonth.month    == month,
        )
        .first()
    )

    # Recompute unlocked rows so an edited salary shows in the PDF; locked
    # snapshots stay frozen (CLAUDE.md rules 5 & 6).
    if pm is None or pm.status != "locked":
        pm = process_payroll_month(emp_code, year, month, db, generated_by=current_user.emp_code)

    context = _build_response(pm, db)
    pdf_bytes = generate_pdf(context)

    filename = f"payslip_{emp_code}_{year}_{month:02d}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


class ProcessMonthBody(BaseModel):
    entity_id: str
    year:      int
    month:     int


@router.post("/process-month")
def process_month(
    body: ProcessMonthBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    # For entity_admin, restrict to own entity
    if current_user.role == "entity_admin":
        my_entity = (
            db.query(Employee.entity_id)
            .filter(Employee.emp_code == current_user.emp_code)
            .scalar()
        )
        if body.entity_id != my_entity:
            raise HTTPException(status_code=403, detail="Access denied")

    active_employees = (
        db.query(Employee)
        .filter(Employee.entity_id == body.entity_id, Employee.status == "active")
        .all()
    )

    processed = 0
    errors: list[dict] = []

    for emp in active_employees:
        try:
            process_payroll_month(
                emp.emp_code, body.year, body.month, db,
                generated_by=current_user.emp_code,
            )
            processed += 1
        except HTTPException as exc:
            errors.append({"emp_code": emp.emp_code, "error": exc.detail})
        except Exception as exc:
            errors.append({"emp_code": emp.emp_code, "error": str(exc)})

    return {"processed": processed, "errors": errors}


# ---------------------------------------------------------------------------
# Payroll operations console — month status + lock / unlock
# (Mounted at /api/payroll. payroll_months.status ∈ draft|processed|locked.
#  Lock sets locked_at=now(); unlock sets status='processed', locked_at=NULL.
#  No locked_by column — actor + reason recorded in audit_log only.)
# ---------------------------------------------------------------------------

def _my_entity(db: Session, current_user: User) -> Optional[str]:
    """entity_id of the current user, or None for super_admin (unscoped)."""
    if current_user.role == "super_admin":
        return None
    return (
        db.query(Employee.entity_id)
        .filter(Employee.emp_code == current_user.emp_code)
        .scalar()
    )


def _agg_status(locked: int, draft: int, total: int) -> str:
    """all locked -> locked; all draft -> draft; otherwise processed."""
    if total > 0 and locked == total:
        return "locked"
    if total > 0 and draft == total:
        return "draft"
    return "processed"


@payroll_router.get("/months")
def list_payroll_months(
    entity_id: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """Aggregated payroll status, one row per (entity_id, year, month) with data."""
    if year is None:
        year = date.today().year

    # Entity scope: non-super_admin is forced to their own entity.
    scope = _my_entity(db, current_user)
    if scope is not None:
        entity_id = scope

    q = (
        db.query(
            Employee.entity_id.label("entity_id"),
            PayrollMonth.year.label("year"),
            PayrollMonth.month.label("month"),
            func.count(PayrollMonth.id).label("employee_count"),
            func.coalesce(func.sum(PayrollMonth.net_pay), 0).label("total_net"),
            func.coalesce(func.sum(PayrollMonth.gross), 0).label("total_gross"),
            func.sum(case((PayrollMonth.status == "locked", 1), else_=0)).label("locked_count"),
            func.sum(case((PayrollMonth.status == "processed", 1), else_=0)).label("processed_count"),
            func.sum(case((PayrollMonth.status == "draft", 1), else_=0)).label("draft_count"),
            func.max(PayrollMonth.locked_at).label("locked_at"),
        )
        .join(Employee, Employee.emp_code == PayrollMonth.emp_code)
        .filter(PayrollMonth.year == year)
        .group_by(Employee.entity_id, PayrollMonth.year, PayrollMonth.month)
        .order_by(PayrollMonth.year.desc(), PayrollMonth.month.desc())
    )
    if entity_id:
        q = q.filter(Employee.entity_id == entity_id)

    months = []
    for r in q.all():
        total = int(r.employee_count or 0)
        locked = int(r.locked_count or 0)
        draft = int(r.draft_count or 0)
        months.append({
            "entity_id":       r.entity_id,
            "year":            r.year,
            "month":           r.month,
            "employee_count":  total,
            "status":          _agg_status(locked, draft, total),
            "total_net":       float(r.total_net or 0),
            "total_gross":     float(r.total_gross or 0),
            "locked_count":    locked,
            "processed_count": int(r.processed_count or 0),
            "draft_count":     draft,
            "locked_at":       r.locked_at.isoformat() if r.locked_at else None,
        })
    return {"year": year, "months": months}


class LockBody(BaseModel):
    entity_id: str
    year:      int
    month:     int


class UnlockBody(BaseModel):
    entity_id: str
    year:      int
    month:     int
    reason:    str


def _period_rows(db: Session, entity_id: str, year: int, month: int) -> list[PayrollMonth]:
    return (
        db.query(PayrollMonth)
        .join(Employee, Employee.emp_code == PayrollMonth.emp_code)
        .filter(
            Employee.entity_id == entity_id,
            PayrollMonth.year == year,
            PayrollMonth.month == month,
        )
        .all()
    )


@payroll_router.post("/lock")
def lock_payroll(
    body: LockBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """Lock all payroll_months rows for a period (entity_admin scoped to own entity)."""
    scope = _my_entity(db, current_user)
    if scope is not None and body.entity_id != scope:
        raise HTTPException(status_code=403, detail="Access denied for this entity")

    rows = _period_rows(db, body.entity_id, body.year, body.month)
    if not rows:
        raise HTTPException(
            status_code=400,
            detail=f"No payroll data for {body.entity_id} {body.year}/{body.month:02d}",
        )

    now = datetime.now(timezone.utc)
    for pm in rows:
        if pm.status != "locked":
            pm.status = "locked"
            pm.locked_at = now

    db.add(AuditLog(
        user_code  = current_user.emp_code,
        action     = "PAYROLL_LOCK",
        table_name = "payroll_months",
        record_id  = f"{body.entity_id}-{body.year}-{body.month}",
        new_values = {
            "locked_count": len(rows),
            "entity_id":    body.entity_id,
            "year":         body.year,
            "month":        body.month,
        },
    ))
    db.commit()
    return {"locked_count": len(rows), "status": "locked"}


@payroll_router.post("/unlock")
def unlock_payroll(
    body: UnlockBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin")),
):
    """Unlock a locked period — super_admin only, mandatory reason. Flips status
    back to 'processed' and clears locked_at; does NOT recompute snapshots."""
    if not body.reason or len(body.reason.strip()) < 5:
        raise HTTPException(status_code=400, detail="A reason of at least 5 characters is required to unlock")

    rows = _period_rows(db, body.entity_id, body.year, body.month)
    if not rows:
        raise HTTPException(
            status_code=400,
            detail=f"No payroll data for {body.entity_id} {body.year}/{body.month:02d}",
        )

    locked_rows = [pm for pm in rows if pm.status == "locked"]
    if not locked_rows:
        raise HTTPException(status_code=400, detail="Month is not locked")

    for pm in locked_rows:
        pm.status = "processed"
        pm.locked_at = None

    db.add(AuditLog(
        user_code  = current_user.emp_code,
        action     = "PAYROLL_UNLOCK",
        table_name = "payroll_months",
        record_id  = f"{body.entity_id}-{body.year}-{body.month}",
        new_values = {
            "unlocked_count": len(locked_rows),
            "reason":         body.reason.strip(),
            "entity_id":      body.entity_id,
            "year":           body.year,
            "month":          body.month,
        },
    ))
    db.commit()
    return {"unlocked_count": len(locked_rows), "status": "processed"}


# ---------------------------------------------------------------------------
# POST /late-override — admin edit of late-absent / LD before lock (15.4)
# ---------------------------------------------------------------------------

class LateOverrideBody(BaseModel):
    emp_code: str
    year:     int
    month:    int
    absent_from_late: Optional[float] = None
    ld:               Optional[float] = None
    reason:           str


@payroll_router.post("/late-override")
def late_override(
    body: LateOverrideBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """Override the auto-computed late-absent days and/or LD for an UNLOCKED month.
    Sets the override flag(s) so a later reprocess keeps the value, reconciles leave
    coverage to the new absent_from_late, and recomputes net pay. Locked → 400."""
    if body.absent_from_late is None and body.ld is None:
        raise HTTPException(status_code=400, detail="Provide absent_from_late and/or ld to override")
    if not body.reason or len(body.reason.strip()) < 4:
        raise HTTPException(status_code=400, detail="A reason of at least 4 characters is required")

    # Entity scope for non-super_admin.
    scope = _my_entity(db, current_user)
    emp_entity = db.query(Employee.entity_id).filter(Employee.emp_code == body.emp_code).scalar()
    if emp_entity is None:
        raise HTTPException(status_code=404, detail=f"Employee {body.emp_code} not found")
    if scope is not None and emp_entity != scope:
        raise HTTPException(status_code=403, detail="Access denied for this entity")

    pm = (
        db.query(PayrollMonth)
        .filter(PayrollMonth.emp_code == body.emp_code,
                PayrollMonth.year == body.year, PayrollMonth.month == body.month)
        .first()
    )
    if pm and pm.status == "locked":
        raise HTTPException(status_code=400, detail="Month is locked — overrides are not allowed")

    # Ensure a processed row exists to override.
    if pm is None:
        pm = process_payroll_month(body.emp_code, body.year, body.month, db, generated_by=current_user.emp_code)

    old = {"absent_from_late": float(pm.absent_from_late or 0), "ld": float(pm.ld or 0)}

    if body.absent_from_late is not None:
        pm.absent_from_late = body.absent_from_late
        pm.late_absent_overridden = True
    if body.ld is not None:
        pm.ld = body.ld
        pm.ld_overridden = True
    db.commit()

    # Reprocess honouring the override flags (reconciles leave + recomputes net).
    pm = process_payroll_month(body.emp_code, body.year, body.month, db, generated_by=current_user.emp_code)

    db.add(AuditLog(
        user_code  = current_user.emp_code,
        action     = "LATE_LD_OVERRIDE",
        table_name = "payroll_months",
        record_id  = f"{body.emp_code}-{body.year}-{body.month}",
        old_values = old,
        new_values = {
            "absent_from_late": float(pm.absent_from_late or 0),
            "ld":               float(pm.ld or 0),
            "reason":           body.reason.strip(),
        },
    ))
    db.commit()
    return {
        "emp_code": body.emp_code, "year": body.year, "month": body.month,
        "absent_from_late": float(pm.absent_from_late or 0),
        "ld": float(pm.ld or 0),
        "ld_overridden": bool(pm.ld_overridden),
        "late_absent_overridden": bool(pm.late_absent_overridden),
    }
