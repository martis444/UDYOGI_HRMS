import calendar
import math
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import extract
from sqlalchemy.orm import Session

from app.models.employee import AuditLog, AttendanceDaily, Employee, Location, PayrollMonth
from app.services.pt_resolver import get_pt_amount
from app.services.period_calculator import get_working_days_info
from app.services.salary_resolver import get_structure_for_period
from app.services.loan_service import apply_emi_on_payroll


def compute_payroll(emp_code: str, year: int, month: int, db: Session) -> dict:
    """
    Compute payroll figures for an employee for a given month.
    Returns a dict of all computed values — does NOT write to DB.
    """
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee {emp_code} not found")

    location = db.query(Location).filter(Location.id == emp.location_id).first()
    pt_state = location.pt_state_code if location else "NIL"

    # Salary source = the structure effective during THIS payroll period.
    # Increments align to the 1st of a month, so one structure covers the period.
    # Fall back to the live employee columns for pre-history employees / safety.
    struct = get_structure_for_period(db, emp_code, year, month)
    src = struct if struct is not None else emp

    basic           = float(src.basic or 0)
    hra             = float(src.hra or 0)
    da              = float(src.da or 0)
    spl             = float(src.spl or 0)
    cca             = float(src.cca or 0)
    leave_travel    = float(src.leave_travel or 0)
    other_allowance = float(src.other_allowance or 0)

    # Statutory gross: leave_travel included; other_allowance excluded from PF/ESIC/PT base
    gross    = basic + hra + da + spl + cca + leave_travel
    pf_base  = basic + da

    pf_emp = min(round(pf_base * 0.12), 1800) if emp.pf_applicable else 0
    pf_ern = min(round(pf_base * 0.13), 2340) if emp.pf_applicable else 0

    # ESIC always rounds UP (ceiling) per statutory requirement —
    # fractional paise are always rounded in favour of the fund, not the employee.
    if gross <= 21000:
        esic_emp = math.ceil(gross * 0.0075)
        esic_ern = math.ceil(gross * 0.0325)
    else:
        esic_emp = 0
        esic_ern = 0

    pt = 0.0
    if emp.pt_applicable:
        pt = get_pt_amount(gross, pt_state, emp.gender or "all", month, db)

    loan_emi        = 0
    other_deduction = 0
    total_deduction = pf_emp + esic_emp + int(pt) + loan_emi + other_deduction
    # other_allowance is added after all statutory deductions (not part of gross/ESIC/PF base)
    net_pay         = gross - total_deduction + other_allowance
    total_days      = calendar.monthrange(year, month)[1]

    # Proration factor — resolved later in process_payroll_month when pay_days is known

    return {
        "emp_code":        emp_code,
        "year":            year,
        "month":           month,
        "basic":           basic,
        "hra":             hra,
        "da":              da,
        "spl":             spl,
        "cca":             cca,
        "leave_travel":    leave_travel,
        "other_allowance": other_allowance,
        "gross":           gross,
        "pf_emp":          pf_emp,
        "pf_ern":          pf_ern,
        "esic_emp":        esic_emp,
        "esic_ern":        esic_ern,
        "pt":              pt,
        "loan_emi":        loan_emi,
        "other_deduction": other_deduction,
        "total_deduction": total_deduction,
        "net_pay":         net_pay,
        "total_days":      total_days,
        # employee meta (needed by process_payroll_month and payslip response)
        "name":        emp.name,
        "designation": emp.designation,
        "entity_id":   emp.entity_id,
        "location_id": emp.location_id,
        "gender":      emp.gender,
        "pt_state":    pt_state,
    }


def process_payroll_month(
    emp_code: str,
    year: int,
    month: int,
    db: Session,
    generated_by: str,
) -> PayrollMonth:
    """
    Compute payroll and upsert a payroll_months row.
    Raises HTTP 400 if the row is already locked.
    """
    existing = (
        db.query(PayrollMonth)
        .filter(
            PayrollMonth.emp_code == emp_code,
            PayrollMonth.year == year,
            PayrollMonth.month == month,
        )
        .first()
    )

    if existing and existing.status == "locked":
        raise HTTPException(
            status_code=400,
            detail=f"Payroll locked for {emp_code} {year}/{month:02d}",
        )

    data = compute_payroll(emp_code, year, month, db)

    # Loan/advance EMI for this period. apply_emi_on_payroll mutates the loan ledger
    # (decrements outstanding once per period; idempotent on reprocess). loan_emi feeds
    # the DB-GENERATED total_deduction, so recompute total_deduction + net in Python to
    # match (never pass total_deduction to the PayrollMonth constructor).
    loan_emi = float(apply_emi_on_payroll(emp_code, year, month, db))
    data["loan_emi"] = loan_emi
    data["total_deduction"] = (
        data["pf_emp"] + data["esic_emp"] + int(data["pt"]) + loan_emi + data["other_deduction"]
    )

    # Summarise attendance_daily for the month
    att_rows = (
        db.query(AttendanceDaily)
        .filter(
            AttendanceDaily.emp_code == emp_code,
            extract("year",  AttendanceDaily.att_date) == year,
            extract("month", AttendanceDaily.att_date) == month,
        )
        .all()
    )

    def _count(status: str) -> int:
        return sum(1 for r in att_rows if r.att_status == status)

    days_p   = _count("P")
    days_a   = _count("A")
    days_wo  = _count("WO")
    days_cl  = _count("CL")
    days_el  = _count("EL")
    days_sl  = _count("SL")
    days_h   = _count("H")
    days_lwp = _count("LWP")
    ot_hours = sum(float(r.ot_hours or 0) for r in att_rows)

    # When attendance is not yet tracked, default to full-month paid days
    if att_rows:
        pay_days = days_p + days_wo + days_h + days_cl + days_el + days_sl
    else:
        pay_days = None   # no attendance yet → proration=1.0 (pay in full)

    # ── Period + working days ─────────────────────────────────────────────────
    location_id = data.get("location_id") or "kol"
    wdi = get_working_days_info(db, year, month, location_id)
    total_working_days = wdi["total_working_days"]

    # ── Proration ─────────────────────────────────────────────────────────────
    if pay_days is not None and total_working_days > 0:
        proration = Decimal(pay_days) / Decimal(total_working_days)
    elif pay_days is not None and pay_days > 0:
        proration = Decimal(pay_days) / Decimal(26)   # industry fallback
    else:
        proration = Decimal("1.0")                    # no attendance → full pay

    gross_d   = Decimal(str(data["gross"]))
    net_base  = Decimal(str(data["gross"] - data["total_deduction"]))
    prorated_net = float((net_base * proration) + Decimal(str(data["other_allowance"])))

    now = datetime.now(timezone.utc)

    att_fields = dict(
        total_days         = data["total_days"],
        pay_days           = pay_days if pay_days is not None else data["total_days"],
        days_p             = days_p or None,
        days_a             = days_a or None,
        days_wo            = days_wo or None,
        days_cl            = days_cl or None,
        days_el            = days_el or None,
        days_sl            = days_sl or None,
        days_h             = days_h or None,
        days_lwp           = days_lwp or None,
        ot_hours           = ot_hours or None,
        period_start       = wdi["period_start"],
        period_end         = wdi["period_end"],
        total_working_days = total_working_days,
    )

    if existing:
        for field in ("basic", "hra", "da", "spl", "cca", "leave_travel", "other_allowance",
                      "gross", "pf_emp", "pf_ern", "esic_emp", "esic_ern", "pt",
                      "loan_emi", "other_deduction"):
            setattr(existing, field, data[field])
        existing.net_pay = prorated_net
        for field, val in att_fields.items():
            setattr(existing, field, val)
        existing.status       = "processed"
        existing.generated_at = now
        existing.generated_by = generated_by
        pm = existing
    else:
        pm = PayrollMonth(
            emp_code        = emp_code,
            year            = year,
            month           = month,
            basic           = data["basic"],
            hra             = data["hra"],
            da              = data["da"],
            spl             = data["spl"],
            cca             = data["cca"],
            leave_travel    = data["leave_travel"],
            other_allowance = data["other_allowance"],
            gross           = data["gross"],
            pf_emp          = data["pf_emp"],
            pf_ern          = data["pf_ern"],
            esic_emp        = data["esic_emp"],
            esic_ern        = data["esic_ern"],
            pt              = data["pt"],
            loan_emi        = data["loan_emi"],
            other_deduction = data["other_deduction"],
            # total_deduction is a GENERATED ALWAYS column — PostgreSQL computes it
            net_pay         = prorated_net,
            status          = "processed",
            generated_at    = now,
            generated_by    = generated_by,
            **att_fields,
        )
        db.add(pm)

    db.add(AuditLog(
        user_code  = generated_by,
        action     = "PAYROLL_PROCESS",
        table_name = "payroll_months",
        record_id  = emp_code,
        new_values = {
            "year":    year,
            "month":   month,
            "gross":   data["gross"],
            "net_pay": data["net_pay"],
        },
    ))

    db.commit()
    db.refresh(pm)
    return pm
