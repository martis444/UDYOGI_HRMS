import calendar
import math
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.employee import AuditLog, AttendanceDaily, Employee, Location, PayrollMonth
from app.services.pt_resolver import get_pt_amount
from app.services.period_calculator import get_working_days_info
from app.services.salary_resolver import get_structure_for_period
from app.services.loan_service import apply_emi_on_payroll
from app.services.late_service import compute_late_effects


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
    spl             = float(src.spl or 0)
    cca             = float(src.cca or 0)
    leave_travel    = float(src.leave_travel or 0)
    other_allowance = float(src.other_allowance or 0)

    # Statutory gross: leave_travel included; other_allowance excluded from PF/ESIC/PT base.
    # DA was folded into basic in 15.1 — PF base is `basic` only now.
    gross    = basic + hra + spl + cca + leave_travel
    pf_base  = basic

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
    # other_allowance is RECORD-ONLY (ad-hoc payout tracked outside payroll) — NOT in net.
    net_pay         = gross - total_deduction
    total_days      = calendar.monthrange(year, month)[1]

    # Proration factor — resolved later in process_payroll_month when pay_days is known

    return {
        "emp_code":        emp_code,
        "year":            year,
        "month":           month,
        "basic":           basic,
        "hra":             hra,
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

    # Attendance for this pay run uses the 26th cutoff cycle (15.3): pay period
    # (year, month) covers the 26th of the previous month .. the 25th of this month.
    # So a day on/after the 26th belongs to the NEXT month's run (matches how
    # approved leave is reflected onto the attendance sheet).
    cutoff = settings.CYCLE_CUTOFF_DAY
    win_start = date(year - 1, 12, cutoff) if month == 1 else date(year, month - 1, cutoff)
    win_end = date(year, month, cutoff - 1)
    att_rows = (
        db.query(AttendanceDaily)
        .filter(
            AttendanceDaily.emp_code == emp_code,
            AttendanceDaily.att_date >= win_start,
            AttendanceDaily.att_date <= win_end,
        )
        .all()
    )

    # att_status values match the DB CHECK on attendance_daily (lowercase words),
    # which is what the biometric processor + punch endpoint + leave reflection write.
    def _count(status: str) -> int:
        return sum(1 for r in att_rows if r.att_status == status)

    days_p   = _count("present")
    days_a   = _count("absent")
    days_wo  = _count("wo")
    days_cl  = _count("cl")
    days_pl  = _count("pl")
    days_sl  = _count("sl")
    days_h   = _count("holiday")
    days_lwp = _count("lwp")
    ot_hours = sum(float(r.ot_hours or 0) for r in att_rows)

    # Session 18 — CSV attendance is authoritative. The monthly CSV import writes
    # aggregate day-counts straight to payroll_months but NO per-day attendance_daily
    # rows. Without this guard, reprocessing (e.g. generating the payslip) would
    # recompute days_a=0 from the empty per-day table and reset pay_days to full,
    # wiping the uploaded attendance. So: when there are no per-day rows but an
    # existing row already carries uploaded attendance, preserve it. Per-day data,
    # whenever present, still wins (biometric punches / reflected approved leaves).
    csv_authoritative = (not att_rows) and existing is not None and existing.pay_days is not None
    if csv_authoritative:
        days_p   = int(existing.days_p or 0)
        days_a   = int(existing.days_a or 0)
        days_wo  = int(existing.days_wo or 0)
        days_cl  = int(existing.days_cl or 0)
        days_pl  = int(existing.days_pl or 0)
        days_sl  = int(existing.days_sl or 0)
        days_h   = int(existing.days_h or 0)
        days_lwp = int(existing.days_lwp or 0)
        ot_hours = float(existing.ot_hours or 0)

    # ── Late-coming penalty (15.4) ────────────────────────────────────────────
    # Every 3 'late' days = 1 absent-equivalent, covered first from CL/SL/PL, the
    # rest charged as LD. Uncovered late days are charged ONCE — as LD only — NOT
    # also folded into the /30 LOP proration (LOP stays = real absent + lwp).
    # Honour any admin override stored on the existing row.
    absent_override = (
        float(existing.absent_from_late) if (existing and existing.late_absent_overridden) else None
    )
    ld_override = float(existing.ld) if (existing and existing.ld_overridden) else None
    late = compute_late_effects(
        emp_code, year, month, db,
        monthly_gross=data["gross"],
        absent_override=absent_override,
        ld_override=ld_override,
    )
    data["ld"] = late["ld"]
    # ld feeds the DB-GENERATED total_deduction — recompute in Python to match.
    data["total_deduction"] = (
        data["pf_emp"] + data["esic_emp"] + int(data["pt"])
        + data["loan_emi"] + data["other_deduction"] + data["ld"]
    )

    # ── Period + working days (stored for display; not used for proration) ─────
    location_id = data.get("location_id") or "kol"
    wdi = get_working_days_info(db, year, month, location_id)
    total_working_days = wdi["total_working_days"]

    # ── /30 attendance-driven proration (15.1) ────────────────────────────────
    # LOP days = absent + leave-without-pay (+ uncovered late-absences, 15.4).
    # No attendance rows → days_a/days_lwp = 0 → factor = 1.0 → full pay.
    divisor  = settings.PER_DAY_DIVISOR
    lop_days = days_a + days_lwp
    # CSV-authoritative months keep the uploaded pay_days verbatim; otherwise derive it.
    pay_days = int(existing.pay_days) if csv_authoritative else max(0, divisor - lop_days)
    payable_factor = Decimal(pay_days) / Decimal(divisor)

    # Earnings prorate by payable_factor; deductions stay on the full statutory
    # gross (rule from 13.9). other_allowance is RECORD-ONLY now (kept as a snapshot
    # on the row, but never added to take-home).
    stat_earnings  = Decimal(str(data["gross"]))             # basic+hra+spl+cca+lt
    total_ded      = Decimal(str(data["total_deduction"]))
    total_earnings = stat_earnings * payable_factor
    prorated_net   = float(total_earnings - total_ded)

    now = datetime.now(timezone.utc)

    att_fields = dict(
        total_days         = data["total_days"],
        pay_days           = pay_days,   # = PER_DAY_DIVISOR - LOP_days (floored at 0)
        days_p             = days_p or None,
        days_a             = days_a or None,
        days_wo            = days_wo or None,
        days_cl            = days_cl or None,
        days_pl            = days_pl or None,
        days_sl            = days_sl or None,
        days_h             = days_h or None,
        days_lwp           = days_lwp or None,
        ot_hours           = ot_hours or None,
        late_days          = (int(existing.late_days or 0) if csv_authoritative else late["late_days"]),
        absent_from_late   = late["absent_from_late"],
        ld                 = data["ld"],
        period_start       = wdi["period_start"],
        period_end         = wdi["period_end"],
        total_working_days = total_working_days,
    )

    if existing:
        for field in ("basic", "hra", "spl", "cca", "leave_travel", "other_allowance",
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
