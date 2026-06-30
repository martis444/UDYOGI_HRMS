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
from app.services.leave_engine import resolve_leave_balance
from app.services.pdf_generator import (
    generate_pdf, generate_bulk_pdf, generate_salary_sheet_xlsx, num_to_words,
)
from app.services.salary_resolver import get_structure_for_period
from app.services import email_service, loan_service

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
    # Structured CL/SL/PL leave block — TB (entitlement) / ULB (used) / ALB (available)
    # from the single source of truth (derived; read-only here — no write-through so
    # PDF/data generation stays side-effect-free). Matches GET /balance for the same moment.
    leave = resolve_leave_balance(pm.emp_code, date.today(), db, write_through=False)
    leave_balances = {lt.upper(): leave[lt]["alb"] for lt in ("cl", "sl", "pl")}

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
    med_r   = float(pm.medical or 0)                  # paid earning, in gross — prorates like basic
    oa      = round(float(pm.other_allowance or 0))   # OTHER ALLOW: per-month value (full value)
    oe      = round(float(pm.other_earning or 0))     # OTHER EARNING: fixed monthly component (full value)
    # Un-merged (Session 22): OTHER EARNING and OTHER ALLOW are two SEPARATE paid
    # lines, both non-statutory (outside the PF/ESIC/PT base).

    basic_amt = round(basic_r * factor)
    hra_amt   = round(hra_r   * factor)
    spl_amt   = round(spl_r   * factor)
    cca_amt   = round(cca_r   * factor)
    lt_amt    = round(lt_r    * factor)
    med_amt   = round(med_r   * factor)

    # Medical is in the statutory gross (Session 22) → prorates with basic/hra/etc.
    gross_rate     = int(basic_r + hra_r + spl_r + cca_r + lt_r + med_r)
    total_earnings = basic_amt + hra_amt + spl_amt + cca_amt + lt_amt + med_amt + oe + oa

    pf_val   = int(float(pm.pf_emp or 0))
    esic_val = int(float(pm.esic_emp or 0))
    pt_val   = int(float(pm.pt or 0))
    loan_val = int(float(pm.loan_emi or 0))
    ld_val   = int(round(float(pm.ld or 0)))   # Late Deduction (15.4)
    oth_ded  = int(float(pm.other_deduction or 0))
    it_val   = int(round(float(pm.income_tax or 0)))   # Income Tax (manual, Session 22)
    nps_val  = int(round(float(pm.nps or 0)))          # NPS (manual, Session 22)
    total_ded      = pf_val + esic_val + pt_val + loan_val + ld_val + oth_ded + it_val + nps_val
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
        "medical":         med_r,                  # paid earning, in gross
        "other_allowance": oa,                     # OTHER ALLOW (per-month), paid, non-statutory
        "other_earning":   oe,                     # OTHER EARNING (fixed), paid, non-statutory
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
        "medical_rate":   int(med_r),
        "medical_amount": med_amt,
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
        "income_tax":      it_val,   # Income Tax (manual, Session 22)
        "nps":             nps_val,  # NPS (manual, Session 22)
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
        "sap_code":        emp.sap_code if emp else None,
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


def _entity_payroll_rows(db, entity_id, year, month):
    """Active-employee payroll rows for an entity/month, ordered by name."""
    return (
        db.query(PayrollMonth)
        .join(Employee, Employee.emp_code == PayrollMonth.emp_code)
        .filter(
            Employee.entity_id == entity_id,
            PayrollMonth.year == year,
            PayrollMonth.month == month,
        )
        .order_by(Employee.name)
        .all()
    )


def _assert_entity_admin_scope(db, current_user, entity_id):
    if current_user.role == "entity_admin":
        my_entity = (
            db.query(Employee.entity_id)
            .filter(Employee.emp_code == current_user.emp_code)
            .scalar()
        )
        if entity_id != my_entity:
            raise HTTPException(status_code=403, detail="Access denied")


def _contexts_for_month(db, current_user, entity_id, year, month):
    """Build the payslip context for every employee in the entity/month. Unlocked
    rows are recomputed first (so the latest salary/attendance shows); locked stay frozen."""
    pms = _entity_payroll_rows(db, entity_id, year, month)
    if not pms:
        raise HTTPException(status_code=404, detail="No payroll rows for this entity/month. Process payroll first.")
    contexts = []
    for pm in pms:
        if pm.status != "locked":
            pm = process_payroll_month(pm.emp_code, year, month, db, generated_by=current_user.emp_code)
        contexts.append(_build_response(pm, db))
    return contexts


@router.get("/bulk-pdf")
def get_bulk_payslip_pdf(
    entity_id: str = Query(...),
    year:      int = Query(...),
    month:     int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """All employees' payslips for an entity/month merged into one PDF (one per page)."""
    _assert_entity_admin_scope(db, current_user, entity_id)
    contexts = _contexts_for_month(db, current_user, entity_id, year, month)
    pdf_bytes = generate_bulk_pdf(contexts)

    db.add(AuditLog(
        user_code=current_user.emp_code, action="PAYSLIP_BULK_EXPORT",
        table_name="payroll_months", record_id=f"{entity_id}:{year}-{month:02d}",
        new_values={"count": len(contexts)},
    ))
    db.commit()

    filename = f"payslips_{entity_id}_{year}_{month:02d}.pdf"
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/salary-sheet")
def get_salary_sheet_pdf(
    entity_id: str = Query(...),
    year:      int = Query(...),
    month:     int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """A3-landscape payroll register for an entity/month (all employees in rows).
    Column order matches the client's master salary-sheet format (Session 22)."""
    _assert_entity_admin_scope(db, current_user, entity_id)
    contexts = _contexts_for_month(db, current_user, entity_id, year, month)

    # Master column order: identity + attendance counts, then earnings, then deductions.
    text_keys = ("emp_code", "sap_id", "name")
    headers = [
        "#", "Emp Code", "SAP ID", "Employee Name",
        "Total Pay Days", "PR", "ABS", "WO", "CL", "HO", "Loan Closing Bal",
        "Basic", "HRA", "Medical", "Special", "Other Earning", "CCA", "LTA", "Other Allow",
        "Earn Total",
        "PF", "ESIC", "Prof Tax", "Loan", "Income Tax", "Miscellaneous", "NPS",
        "Deduct Total", "Net Total",
    ]
    num_keys = [
        "pay_days", "pr", "abs", "wo", "cl", "ho", "loan_closing",
        "basic", "hra", "medical", "special", "other_earning", "cca", "lta", "other_allow",
        "earn_total",
        "pf", "esic", "pt", "loan", "income_tax", "misc", "nps",
        "deduct_total", "net",
    ]
    # Columns that get a meaningful column TOTAL (money); attendance counts / pay_days
    # are left blank in the total row.
    sum_keys = {"loan_closing", "basic", "hra", "medical", "special", "other_earning",
                "cca", "lta", "other_allow", "earn_total", "pf", "esic", "pt", "loan",
                "income_tax", "misc", "nps", "deduct_total", "net"}

    totals = {k: 0 for k in sum_keys}
    rows = []
    for c in contexts:
        loan_closing = float(loan_service.closing_balance_as_of(c["emp_code"], year, month, db))
        row = {
            "emp_code": c["emp_code"], "sap_id": c.get("sap_code") or "", "name": c["name"],
            "pay_days": c["pay_days"] if c["pay_days"] is not None else c["total_days"],
            "pr": c["days_p"] or 0, "abs": c["days_a"] or 0, "wo": c["days_wo"] or 0,
            "cl": c["days_cl"] or 0, "ho": c["days_h"] or 0, "loan_closing": loan_closing,
            "basic": c["basic_amount"], "hra": c["hra_amount"], "medical": c["medical_amount"],
            "special": c["spl_amount"], "other_earning": c["other_earning"], "cca": c["cca_amount"],
            "lta": c["lt_amount"], "other_allow": c["other_allowance"], "earn_total": c["total_earnings"],
            "pf": c["pf_emp"], "esic": c["esic_emp"], "pt": c["pt"], "loan": c["loan_emi"],
            # Master format has no LD column — fold Late Deduction into Miscellaneous so
            # the deduction columns reconcile to Deduct Total (both are ad-hoc penalties).
            "income_tax": c["income_tax"], "misc": c["other_deduction"] + c["ld"], "nps": c["nps"],
            "deduct_total": c["total_deduction"], "net": c["net_pay"],
        }
        rows.append(row)
        for k in sum_keys:
            totals[k] += row[k]

    first = contexts[0]
    context = {
        "entity_name":   first["entity_name"],
        "month_year":    f"{_MONTH_NAMES.get(month, '').upper()} - {year}",
        "headers":       headers,
        "text_keys":     list(text_keys),
        "num_keys":      num_keys,
        "rows":          rows,
        "totals":        totals,
        "generated_on":  datetime.now(timezone.utc).strftime("%d-%b-%Y %H:%M UTC"),
    }
    xlsx_bytes = generate_salary_sheet_xlsx(context)

    db.add(AuditLog(
        user_code=current_user.emp_code, action="SALARY_SHEET_EXPORT",
        table_name="payroll_months", record_id=f"{entity_id}:{year}-{month:02d}",
        new_values={"count": len(rows)},
    ))
    db.commit()

    filename = f"salary_sheet_{entity_id}_{year}_{month:02d}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------------
# Email payslips (Session 22 #5)
#   /email/preview — dry run: who gets it / who's skipped (no email). Sends nothing.
#   /email/send    — real send (LOCKED months only) OR a test send (any status) when
#                    test_to is set. stdlib SMTP via services/email_service.
# ---------------------------------------------------------------------------

class EmailPayslipsBody(BaseModel):
    entity_id: str
    year:      int
    month:     int
    test_to:   Optional[str] = None   # set → send a single sample here instead of a real run


def _email_contexts(db, current_user, entity_id, year, month) -> tuple[list[dict], bool]:
    """Build payslip contexts for an entity/month without side effects, plus whether
    the month is fully locked. Read-only — unlocked rows are NOT reprocessed here (a
    real send is locked-only anyway; preview/test just reflect the stored snapshot)."""
    rows = _entity_payroll_rows(db, entity_id, year, month)
    if not rows:
        raise HTTPException(status_code=404, detail="No payroll rows for this entity/month. Process payroll first.")
    locked = all(pm.status == "locked" for pm in rows)
    contexts = [_build_response(pm, db) for pm in rows]
    return contexts, locked


@router.post("/email/preview")
def email_payslips_preview(
    body: EmailPayslipsBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """Who would receive an emailed payslip and who would be skipped. Sends nothing."""
    _assert_entity_admin_scope(db, current_user, body.entity_id)
    contexts, locked = _email_contexts(db, current_user, body.entity_id, body.year, body.month)
    preview = email_service.preview_recipients(db, contexts)
    return {**preview, "locked": locked, "smtp_configured": email_service.smtp_configured()}


@router.post("/email/send")
def email_payslips_send(
    body: EmailPayslipsBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """Email payslips. With test_to set, sends ONE sample there (any status). Otherwise
    a real run — allowed only for a fully LOCKED month so the emailed PDF is final."""
    _assert_entity_admin_scope(db, current_user, body.entity_id)
    if not email_service.smtp_configured():
        raise HTTPException(
            status_code=400,
            detail="Email is not configured on the server. Ask IT to set SMTP_* in the backend .env.",
        )
    contexts, locked = _email_contexts(db, current_user, body.entity_id, body.year, body.month)

    if body.test_to:
        res = email_service.send_test(
            db, actor=current_user.emp_code, entity_id=body.entity_id,
            year=body.year, month=body.month, contexts=contexts, to_addr=body.test_to,
        )
        if not res.get("ok"):
            raise HTTPException(status_code=400, detail=res.get("error", "Test send failed"))
        return res

    if not locked:
        raise HTTPException(
            status_code=400,
            detail="Payslips can only be emailed for a LOCKED month. Lock the month first.",
        )
    res = email_service.deliver_payslips(
        db, actor=current_user.emp_code, entity_id=body.entity_id,
        year=body.year, month=body.month, contexts=contexts,
    )
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Send failed"))
    return res


def email_payslips_for_locked_month(db, *, actor, entity_id, year, month) -> dict:
    """Scheduler entry point (main.py). Emails the month's payslips ONLY if every row
    is locked; otherwise returns a reason so the caller can record a skip+alert.
    Side-effect-free context build (locked rows are frozen snapshots)."""
    rows = _entity_payroll_rows(db, entity_id, year, month)
    if not rows:
        return {"ok": False, "reason": "no_rows"}
    if any(pm.status != "locked" for pm in rows):
        return {"ok": False, "reason": "not_locked", "employee_count": len(rows)}
    contexts = [_build_response(pm, db) for pm in rows]
    return email_service.deliver_payslips(
        db, actor=actor, entity_id=entity_id, year=year, month=month, contexts=contexts,
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


# ---------------------------------------------------------------------------
# POST /it-nps-override — admin edit of Income Tax / NPS before lock (Session 22)
# ---------------------------------------------------------------------------

class ITNpsOverrideBody(BaseModel):
    emp_code:   str
    year:       int
    month:      int
    income_tax: Optional[float] = None
    nps:        Optional[float] = None
    reason:     str


@payroll_router.post("/it-nps-override")
def it_nps_override(
    body: ITNpsOverrideBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """Set the manual Income Tax and/or NPS deduction for an UNLOCKED month. The values
    are preserved across reprocess (engine) and feed the GENERATED total_deduction, so
    net pay recomputes. Locked → 400. Mirrors /late-override."""
    if body.income_tax is None and body.nps is None:
        raise HTTPException(status_code=400, detail="Provide income_tax and/or nps to set")
    if not body.reason or len(body.reason.strip()) < 4:
        raise HTTPException(status_code=400, detail="A reason of at least 4 characters is required")
    if (body.income_tax is not None and body.income_tax < 0) or (body.nps is not None and body.nps < 0):
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")

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

    if pm is None:
        pm = process_payroll_month(body.emp_code, body.year, body.month, db, generated_by=current_user.emp_code)

    old = {"income_tax": float(pm.income_tax or 0), "nps": float(pm.nps or 0)}

    if body.income_tax is not None:
        pm.income_tax = body.income_tax
    if body.nps is not None:
        pm.nps = body.nps
    db.commit()

    # Reprocess preserves the new income_tax/nps (engine) and recomputes net.
    pm = process_payroll_month(body.emp_code, body.year, body.month, db, generated_by=current_user.emp_code)

    db.add(AuditLog(
        user_code  = current_user.emp_code,
        action     = "IT_NPS_OVERRIDE",
        table_name = "payroll_months",
        record_id  = f"{body.emp_code}-{body.year}-{body.month}",
        old_values = old,
        new_values = {
            "income_tax": float(pm.income_tax or 0),
            "nps":        float(pm.nps or 0),
            "reason":     body.reason.strip(),
        },
    ))
    db.commit()
    return {
        "emp_code": body.emp_code, "year": body.year, "month": body.month,
        "income_tax": float(pm.income_tax or 0),
        "nps":        float(pm.nps or 0),
        "net_pay":    float(pm.net_pay or 0),
    }
