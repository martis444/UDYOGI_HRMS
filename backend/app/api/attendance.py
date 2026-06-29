import calendar
import io
from collections import Counter
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.employee import AuditLog, AttendanceDaily, AttendanceRaw, Employee, PayrollMonth, User
from app.services.import_service import parse_attendance_csv
from app.services.payroll_engine import compute_payroll, process_payroll_month
from app.services.period_calculator import get_working_days_info

router = APIRouter()

# leave att_status code -> CSV leave type label
_ATT_TO_LEAVE = {"cl": "CL", "sl": "SL", "pl": "PL"}


def _attendance_window(year: int, month: int) -> tuple[date, date]:
    """The 26th-cutoff pay-cycle window for a period (same one the payroll engine
    uses): 26th of the previous month .. 25th of this month."""
    c = settings.CYCLE_CUTOFF_DAY
    start = date(year - 1, 12, c) if month == 1 else date(year, month - 1, c)
    end = date(year, month, c - 1)
    return start, end


def _approved_leaves_in_window(db: Session, start: date, end: date,
                               emp_codes: list[str] | None = None) -> dict[str, dict[str, list[date]]]:
    """Approved leave days per employee in the window, from attendance_daily rows
    written by leave approval (att_status cl/sl/pl). → {emp: {CL:[dates], SL:[...], PL:[...]}}."""
    q = (
        db.query(AttendanceDaily)
        .filter(
            AttendanceDaily.att_status.in_(["cl", "sl", "pl"]),
            AttendanceDaily.att_date >= start,
            AttendanceDaily.att_date <= end,
        )
    )
    if emp_codes:
        q = q.filter(AttendanceDaily.emp_code.in_(emp_codes))
    out: dict[str, dict[str, list[date]]] = {}
    for r in q.all():
        lt = _ATT_TO_LEAVE.get(r.att_status)
        if not lt:
            continue
        out.setdefault(r.emp_code, {"CL": [], "SL": [], "PL": []})[lt].append(r.att_date)
    return out


# ---------------------------------------------------------------------------
# POST /import/validate  — dry-run
# ---------------------------------------------------------------------------

@router.post("/import/validate")
async def validate_attendance_import(
    file: UploadFile = File(...),
    year: int = Query(...),
    month: int = Query(...),
    entity_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    if current_user.role == "entity_admin":
        my_entity = (
            db.query(Employee.entity_id)
            .filter(Employee.emp_code == current_user.emp_code)
            .scalar()
        )
        if entity_id != my_entity:
            raise HTTPException(status_code=403, detail="Access denied")

    rows = await parse_attendance_csv(file, db)

    entity_codes = {
        e.emp_code
        for e in db.query(Employee.emp_code)
        .filter(Employee.entity_id == entity_id)
        .all()
    }

    # Count emp_code occurrences to detect duplicates within the file
    code_count = Counter(r["emp_code"] for r in rows if r["emp_code"])

    valid: list[dict] = []
    unmatched: list[dict] = []
    warnings: list[dict] = []
    seen: set[str] = set()

    for i, row in enumerate(rows, start=2):
        emp_code = row["emp_code"]

        # Hard failures → unmatched bucket
        if emp_code is None:
            unmatched.append({
                "row": i,
                "uid": row["uid"],
                "name": row["name"],
                "reason": "UID not found in database",
            })
            continue

        if emp_code not in entity_codes:
            unmatched.append({
                "row": i,
                "uid": row["uid"],
                "name": row["name"],
                "reason": f"{emp_code} does not belong to entity {entity_id}",
            })
            continue

        # Soft issues → warnings
        row_warnings: list[str] = []

        if code_count[emp_code] > 1:
            if emp_code in seen:
                # Keep only the first occurrence; flag subsequent ones as unmatched
                unmatched.append({
                    "row": i,
                    "uid": row["uid"],
                    "name": row["name"],
                    "reason": f"duplicate UID {emp_code} — only first occurrence processed",
                })
                continue
            row_warnings.append(f"duplicate emp_code {emp_code} in file (first occurrence kept)")

        if row["pay_days"] > row["total_days"]:
            row_warnings.append(
                f"pay_days ({row['pay_days']}) > total_days ({row['total_days']})"
            )

        att_sum = (
            row["days_p"] + row["days_a"] + row["days_lwp"] + row["days_wo"]
            + row["days_cl"] + row["days_pl"] + row["days_sl"] + row["days_h"]
        )
        if att_sum != row["total_days"]:
            row_warnings.append(
                f"P+A+L+R+C+PL+S+H={att_sum} ≠ total_days={row['total_days']}"
            )

        if row_warnings:
            warnings.append({"row": i, "emp_code": emp_code, "issues": row_warnings})

        seen.add(emp_code)
        valid.append(row)

    return {
        "total": len(rows),
        "valid_count": len(valid),
        "unmatched_count": len(unmatched),
        "warning_count": len(warnings),
        "valid": valid,
        "unmatched": unmatched,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# POST /import/commit
# ---------------------------------------------------------------------------

class AttendanceCommitBody(BaseModel):
    year: int
    month: int
    entity_id: str
    rows: list[dict]


@router.post("/import/commit")
def commit_attendance_import(
    body: AttendanceCommitBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    if current_user.role == "entity_admin":
        my_entity = (
            db.query(Employee.entity_id)
            .filter(Employee.emp_code == current_user.emp_code)
            .scalar()
        )
        if body.entity_id != my_entity:
            raise HTTPException(status_code=403, detail="Access denied")

    now = datetime.now(timezone.utc)
    imported: list[str] = []
    skipped: list[dict] = []
    warnings: list[dict] = []

    # Approved-leave protection (15.8): approved leaves in this period's 26→25 window
    # are authoritative. If a re-upload tries to reduce a bucket below its approved
    # count, keep the approved count and warn (do not silently overwrite).
    win_start, win_end = _attendance_window(body.year, body.month)
    row_codes = [r.get("emp_code") for r in body.rows if r.get("emp_code")]
    approved_map = _approved_leaves_in_window(db, win_start, win_end, row_codes)

    for row in body.rows:
        emp_code = row.get("emp_code")
        if not emp_code:
            continue

        existing = (
            db.query(PayrollMonth)
            .filter(
                PayrollMonth.emp_code == emp_code,
                PayrollMonth.year == body.year,
                PayrollMonth.month == body.month,
            )
            .first()
        )

        if existing and existing.status == "locked":
            skipped.append({"emp_code": emp_code, "reason": "payroll locked"})
            continue

        att = {
            "total_days": row.get("total_days"),
            "pay_days":   row.get("pay_days"),
            "days_p":     row.get("days_p"),
            "days_a":     row.get("days_a"),
            "days_lwp":   row.get("days_lwp"),
            "days_wo":    row.get("days_wo"),
            "days_cl":    row.get("days_cl"),
            "days_pl":    row.get("days_pl"),
            "days_sl":    row.get("days_sl"),
            "days_h":     row.get("days_h"),
            "late_days":  row.get("late_days") or 0,
            "ot_hours":   row.get("ot_hours"),
            "salary_flag": row.get("salary_flag") or None,
            "remarks":    row.get("remarks") or None,
        }

        # Protect approved leaves: never let the upload reduce a bucket below its
        # approved-in-window count. Clamp up + warn (the approved leave is kept).
        appr = approved_map.get(emp_code)
        if appr:
            for lt, field in (("CL", "days_cl"), ("SL", "days_sl"), ("PL", "days_pl")):
                appr_n = len(appr[lt])
                up_n = int(att.get(field) or 0)
                if appr_n > 0 and up_n < appr_n:
                    att[field] = appr_n
                    dates = " ".join(d.strftime("%d-%b") for d in sorted(appr[lt]))
                    warnings.append({
                        "emp_code": emp_code,
                        "message": f"{emp_code}: uploaded {lt}={up_n} but {appr_n} approved ({dates}) — kept {lt}={appr_n}.",
                    })

        # Optional per-month adjustments. None = blank cell → skip (rule 7); a number
        # overwrites for this month. They survive reprocess (preserved in the engine);
        # other_allowance adds to net, other_deduction subtracts (via total_deduction).
        oa = row.get("other_allowance")
        od = row.get("other_deduction")

        if existing:
            for field, val in att.items():
                setattr(existing, field, val)
            if oa is not None:
                existing.other_allowance = oa
            if od is not None:
                existing.other_deduction = od
            if existing.status == "draft":
                existing.status = "processed"
        else:
            # No prior payroll row — compute salary first, then attach attendance
            try:
                data = compute_payroll(emp_code, body.year, body.month, db)
            except HTTPException as exc:
                skipped.append({"emp_code": emp_code, "reason": exc.detail})
                continue

            pm = PayrollMonth(
                emp_code        = emp_code,
                year            = body.year,
                month           = body.month,
                basic           = data["basic"],
                hra             = data["hra"],
                spl             = data["spl"],
                cca             = data["cca"],
                leave_travel    = data["leave_travel"],
                other_allowance = oa if oa is not None else 0,
                gross           = data["gross"],
                pf_emp          = data["pf_emp"],
                pf_ern          = data["pf_ern"],
                esic_emp        = data["esic_emp"],
                esic_ern        = data["esic_ern"],
                pt              = data["pt"],
                loan_emi        = data["loan_emi"],
                other_deduction = od if od is not None else 0,
                # total_deduction is a GENERATED ALWAYS column — PostgreSQL computes it
                net_pay         = data["net_pay"],
                status          = "processed",
                generated_at    = now,
                generated_by    = current_user.emp_code,
                **att,
            )
            db.add(pm)

        # ── Period + working days ─────────────────────────────────────────────
        emp_row = db.query(Employee).filter(Employee.emp_code == emp_code).first()
        location_id = emp_row.location_id if emp_row else "kol"
        wdi = get_working_days_info(db, body.year, body.month, location_id)
        pm_obj = existing if existing else pm
        pm_obj.period_start       = wdi["period_start"]
        pm_obj.period_end         = wdi["period_end"]
        pm_obj.total_working_days = wdi["total_working_days"]

        # NOTE (15.7/15.8): leave `used` is mutated ONLY at the approval point — the
        # import no longer deducts leave balances (that would double-count against the
        # single source of truth). Approved leaves are protected via the clamp above.

        imported.append(emp_code)

    db.add(AuditLog(
        user_code  = current_user.emp_code,
        action     = "ATTENDANCE_IMPORT",
        table_name = "payroll_months",
        record_id  = "BULK",
        new_values = {
            "year":      body.year,
            "month":     body.month,
            "entity_id": body.entity_id,
            "count":     len(imported),
            "emp_codes": imported,
        },
    ))
    db.commit()

    return {"imported": len(imported), "skipped": skipped, "codes": imported, "warnings": warnings}


# ---------------------------------------------------------------------------
# GET /monthly-summary
# ---------------------------------------------------------------------------

@router.get("/monthly-summary")
def monthly_summary(
    entity_id: str = Query(...),
    year:      int = Query(...),
    month:     int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    if current_user.role != "super_admin":
        my_entity = (
            db.query(Employee.entity_id)
            .filter(Employee.emp_code == current_user.emp_code)
            .scalar()
        )
        if entity_id != my_entity:
            raise HTTPException(status_code=403, detail="Access denied")

    # Self-refresh from attendance_daily so reflected leaves (approvals, 15.9) and
    # biometric punches show without a manual reprocess. Locked months stay frozen.
    #
    # Session 18: the monthly attendance CSV import is AUTHORITATIVE. It writes
    # aggregate day-counts straight to payroll_months but no per-day attendance_daily
    # rows — so we must only reprocess employees who actually HAVE per-day rows in the
    # 26→25 window (biometric / reflected leaves). Reprocessing a CSV-only month would
    # recompute days_a=0 from the empty per-day table and wipe the uploaded attendance.
    win_start, win_end = _attendance_window(year, month)
    locked = {
        c for (c,) in (
            db.query(PayrollMonth.emp_code)
            .join(Employee, Employee.emp_code == PayrollMonth.emp_code)
            .filter(Employee.entity_id == entity_id, PayrollMonth.year == year,
                    PayrollMonth.month == month, PayrollMonth.status == "locked")
            .all()
        )
    }
    att_emps = (
        db.query(AttendanceDaily.emp_code)
        .join(Employee, Employee.emp_code == AttendanceDaily.emp_code)
        .filter(Employee.entity_id == entity_id,
                AttendanceDaily.att_date >= win_start, AttendanceDaily.att_date <= win_end)
        .distinct()
        .all()
    )
    refresh = {c for (c,) in att_emps if c not in locked}
    for c in refresh:
        try:
            process_payroll_month(c, year, month, db, generated_by=current_user.emp_code)
        except Exception:  # noqa: BLE001 — a bad row must not break the whole view
            db.rollback()

    rows = (
        db.query(PayrollMonth, Employee.name, Employee.sap_code)
        .join(Employee, Employee.emp_code == PayrollMonth.emp_code)
        .filter(
            Employee.entity_id == entity_id,
            PayrollMonth.year  == year,
            PayrollMonth.month == month,
        )
        .all()
    )

    return [
        {
            "emp_code":    pm.emp_code,
            "sap_code":    sap_code,
            "name":        name,
            "total_days":  pm.total_days,
            "pay_days":    pm.pay_days,
            "days_p":      pm.days_p,
            "days_a":      pm.days_a,
            "days_lwp":    pm.days_lwp,
            "days_wo":     pm.days_wo,
            "days_cl":     pm.days_cl,
            "days_pl":     pm.days_pl,
            "days_sl":     pm.days_sl,
            "days_h":      pm.days_h,
            "late_days":   pm.late_days,
            "ot_hours":    float(pm.ot_hours or 0),
            "salary_flag": pm.salary_flag,
            "status":      pm.status,
        }
        for pm, name, sap_code in rows
    ]


# ---------------------------------------------------------------------------
# GET /daily
# ---------------------------------------------------------------------------

@router.get("/daily")
def daily_attendance(
    emp_code:  str  = Query(...),
    from_date: date = Query(...),
    to_date:   date = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Employee can only see their own records
    if current_user.role == "employee":
        if current_user.emp_code != emp_code:
            raise HTTPException(status_code=403, detail="Access denied")

    else:
        # entity_admin / super_admin — restrict to same entity
        if current_user.role != "super_admin":
            target_entity = (
                db.query(Employee.entity_id)
                .filter(Employee.emp_code == emp_code)
                .scalar()
            )
            my_entity = (
                db.query(Employee.entity_id)
                .filter(Employee.emp_code == current_user.emp_code)
                .scalar()
            )
            if target_entity != my_entity:
                raise HTTPException(status_code=403, detail="Access denied")

    rows = (
        db.query(AttendanceDaily)
        .filter(
            AttendanceDaily.emp_code == emp_code,
            AttendanceDaily.att_date >= from_date,
            AttendanceDaily.att_date <= to_date,
        )
        .order_by(AttendanceDaily.att_date)
        .all()
    )

    return [
        {
            "att_date":     str(r.att_date),
            "first_in":     r.first_in.isoformat()  if r.first_in  else None,
            "last_out":     r.last_out.isoformat()   if r.last_out  else None,
            "hours_worked": float(r.hours_worked or 0),
            "ot_hours":     float(r.ot_hours or 0),
            "att_status":   r.att_status,
            "source":       r.source,
            "remarks":      r.remarks,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# GET /template  — pre-filled CSV template for attendance import
# ---------------------------------------------------------------------------

@router.get("/template")
def attendance_csv_template(
    entity_id: str = Query(...),
    year:      int = Query(...),
    month:     int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    if current_user.role == "entity_admin":
        my_entity = (
            db.query(Employee.entity_id)
            .filter(Employee.emp_code == current_user.emp_code)
            .scalar()
        )
        if entity_id != my_entity:
            raise HTTPException(status_code=403, detail="Access denied")

    employees = (
        db.query(Employee.emp_code, Employee.name, Employee.sap_code)
        .filter(Employee.entity_id == entity_id, Employee.status == "active")
        .order_by(Employee.name)
        .all()
    )

    total_days = calendar.monthrange(year, month)[1]
    # Identity column is the SAP Code so HR can map employees by their SAP system.
    # (The import resolves SAP Code → emp_code; rows without a SAP code fall back to
    # the system emp_code so no employee becomes unmappable.)
    header = ("SAP Code,Employee Name,Total Days,Pay Days,P,A,L,R,C,PL,S,H,LT,"
              "Other Earning,Other Deduction,Remarks\n")

    # Pre-mark APPROVED leaves for this period's 26→25 window (15.8). This template
    # is aggregate-count format (no per-day cells), so we pre-fill the C/PL/S COUNT
    # columns with the approved-leave day counts and list the exact dates in Remarks
    # so the admin can see them and must not reduce them. (Window matches the payslip.)
    win_start, win_end = _attendance_window(year, month)
    emp_codes = [e.emp_code for e in employees]
    approved = _approved_leaves_in_window(db, win_start, win_end, emp_codes)

    def _fmt_dates(ds: list[date]) -> str:
        return " ".join(d.strftime("%d-%b") for d in sorted(ds))

    buf = io.StringIO()
    buf.write(header)
    for emp_code, name, sap_code in employees:
        safe_name = (name or "").replace(",", " ")
        # Identity = SAP code; fall back to emp_code when an employee has no SAP code
        # so the row stays mappable on re-upload. (The parser resolves either.)
        ident = (sap_code or emp_code or "").replace(",", " ")
        # cols: 0 SAPCode 1 Name 2 TotalDays 3 PayDays 4 P 5 A 6 L 7 R 8 C 9 PL 10 S
        #       11 H 12 LT 13 OtherEarning 14 OtherDed 15 Remarks
        cols = [ident, safe_name, str(total_days)] + [""] * 13
        appr = approved.get(emp_code)
        if appr:
            if appr["CL"]: cols[8]  = str(len(appr["CL"]))
            if appr["PL"]: cols[9]  = str(len(appr["PL"]))
            if appr["SL"]: cols[10] = str(len(appr["SL"]))
            notes = [f"{lt} {_fmt_dates(appr[lt])}" for lt in ("CL", "SL", "PL") if appr[lt]]
            if notes:
                cols[15] = "APPROVED (do not edit): " + "; ".join(notes)
        buf.write(",".join(cols) + "\n")

    # Legend (blank SAP Code → parser skips these rows).
    buf.write("\n")
    buf.write(",LEGEND: C=Casual SL=Sick PL=Privilege counts for the 26th-25th cycle.\n")
    buf.write(",C/PL/S columns pre-filled with APPROVED leave days — do NOT reduce them; see Remarks for dates.\n")
    buf.write(",Fill P (present) / A (absent) / L (LWP) / R (weekly off) / H (holiday) / LT (late) for the rest.\n")
    buf.write(",SAP Code identifies the employee — do NOT edit it.\n")
    buf.write(",Other Earning = one-off reward/extra pay (adds to net); Other Deduction = one-off penalty (cuts net). Blank = none.\n")

    filename = f"attendance_template_{year}_{month:02d}_{entity_id}.csv"
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------------
# GET /today  — current user's punch status for today
# ---------------------------------------------------------------------------

@router.get("/today")
def get_today_attendance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = date.today()
    daily = (
        db.query(AttendanceDaily)
        .filter(
            AttendanceDaily.emp_code == current_user.emp_code,
            AttendanceDaily.att_date == today,
        )
        .first()
    )
    if not daily:
        return {"punched_in": False, "punched_out": False, "first_in": None, "last_out": None, "hours_worked": None}

    return {
        "punched_in": daily.first_in is not None,
        "punched_out": daily.last_out is not None,
        "first_in": daily.first_in.isoformat() if daily.first_in else None,
        "last_out": daily.last_out.isoformat() if daily.last_out else None,
        "hours_worked": float(daily.hours_worked) if daily.hours_worked else None,
    }


# ---------------------------------------------------------------------------
# POST /punch  — punch in or out (auto-detects from today's state)
# ---------------------------------------------------------------------------

@router.post("/punch")
def punch(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    today = now.date()

    emp = db.query(Employee).filter(Employee.emp_code == current_user.emp_code).first()

    daily = (
        db.query(AttendanceDaily)
        .filter(
            AttendanceDaily.emp_code == current_user.emp_code,
            AttendanceDaily.att_date == today,
        )
        .first()
    )

    if not daily or daily.first_in is None:
        # Punch-in
        punch_type = "in"
        raw = AttendanceRaw(
            emp_code=current_user.emp_code,
            punch_time=now,
            punch_type="IN",
            source="manual",
            created_at=now,
        )
        db.add(raw)
        if not daily:
            daily = AttendanceDaily(
                emp_code=current_user.emp_code,
                att_date=today,
                first_in=now,
                att_status="present",
                source="manual",
                location_id=emp.location_id if emp else None,
                shift_id=emp.shift_id if emp else None,
            )
            db.add(daily)
        else:
            daily.first_in = now
            daily.att_status = "present"
            daily.source = "manual"
    else:
        # Punch-out (last_out always updates so multiple punch-outs are fine)
        punch_type = "out"
        raw = AttendanceRaw(
            emp_code=current_user.emp_code,
            punch_time=now,
            punch_type="OUT",
            source="manual",
            created_at=now,
        )
        db.add(raw)
        daily.last_out = now
        hours = (now - daily.first_in).total_seconds() / 3600
        daily.hours_worked = round(hours, 2)
        daily.ot_hours = round(max(0.0, hours - 9.0), 2)

    db.add(
        AuditLog(
            user_code=current_user.emp_code,
            action=f"PUNCH_{punch_type.upper()}",
            table_name="attendance_daily",
            record_id=current_user.emp_code,
            new_values={"date": today.isoformat(), "type": punch_type},
        )
    )
    db.commit()
    db.refresh(daily)

    return {
        "punch_type": punch_type,
        "punched_in": daily.first_in is not None,
        "punched_out": daily.last_out is not None,
        "first_in": daily.first_in.isoformat() if daily.first_in else None,
        "last_out": daily.last_out.isoformat() if daily.last_out else None,
        "hours_worked": float(daily.hours_worked) if daily.hours_worked else None,
    }
