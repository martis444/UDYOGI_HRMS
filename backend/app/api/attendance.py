import calendar
import io
from collections import Counter
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.employee import AuditLog, AttendanceDaily, AttendanceRaw, Employee, LeaveBalance, PayrollMonth, User
from app.services.import_service import parse_attendance_csv
from app.services.payroll_engine import compute_payroll
from app.services.period_calculator import get_working_days_info

router = APIRouter()


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
            + row["days_cl"] + row["days_el"] + row["days_sl"] + row["days_h"]
        )
        if att_sum != row["total_days"]:
            row_warnings.append(
                f"P+A+L+R+C+E+S+H={att_sum} ≠ total_days={row['total_days']}"
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
            "days_el":    row.get("days_el"),
            "days_sl":    row.get("days_sl"),
            "days_h":     row.get("days_h"),
            "ot_hours":   row.get("ot_hours"),
            "salary_flag": row.get("salary_flag") or None,
            "remarks":    row.get("remarks") or None,
        }

        if existing:
            for field, val in att.items():
                setattr(existing, field, val)
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

        # ── Leave balance deduction ───────────────────────────────────────────
        leave_day_map = {
            "CL": int(row.get("days_cl") or 0),
            "SL": int(row.get("days_sl") or 0),
            "EL": int(row.get("days_el") or 0),
        }
        for lt, days_taken in leave_day_map.items():
            if days_taken <= 0:
                continue
            lb = (
                db.query(LeaveBalance)
                .filter(
                    LeaveBalance.emp_code == emp_code,
                    LeaveBalance.leave_type == lt,
                    LeaveBalance.year == body.year,
                )
                .first()
            )
            if lb is None:
                continue
            old_used = float(lb.used or 0)
            lb.used = old_used + days_taken
            if lb.taken_ytd is not None:
                lb.taken_ytd = float(lb.taken_ytd or 0) + days_taken
            db.add(AuditLog(
                user_code  = current_user.emp_code,
                action     = "LEAVE_DEDUCT",
                table_name = "leave_balances",
                record_id  = emp_code,
                new_values = {
                    "leave_type":    lt,
                    "days_deducted": days_taken,
                    "new_used":      float(lb.used),
                },
            ))

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

    return {"imported": len(imported), "skipped": skipped, "codes": imported}


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

    rows = (
        db.query(PayrollMonth, Employee.name)
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
            "name":        name,
            "total_days":  pm.total_days,
            "pay_days":    pm.pay_days,
            "days_p":      pm.days_p,
            "days_a":      pm.days_a,
            "days_lwp":    pm.days_lwp,
            "days_wo":     pm.days_wo,
            "days_cl":     pm.days_cl,
            "days_el":     pm.days_el,
            "days_sl":     pm.days_sl,
            "days_h":      pm.days_h,
            "ot_hours":    float(pm.ot_hours or 0),
            "salary_flag": pm.salary_flag,
            "status":      pm.status,
        }
        for pm, name in rows
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
        db.query(Employee.emp_code, Employee.name)
        .filter(Employee.entity_id == entity_id, Employee.status == "active")
        .order_by(Employee.name)
        .all()
    )

    total_days = calendar.monthrange(year, month)[1]
    header = "Emp Code,Employee Name,Total Days,Pay Days,P,A,L,R,C,E,S,H,OT Hours,Salary Flag,Flag,Remarks\n"

    buf = io.StringIO()
    buf.write(header)
    for emp_code, name in employees:
        safe_name = (name or "").replace(",", " ")
        cols = [emp_code, safe_name, str(total_days)] + [""] * 13
        buf.write(",".join(cols) + "\n")

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
