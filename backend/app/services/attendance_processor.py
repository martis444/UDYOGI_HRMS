import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import cast, Date
from sqlalchemy.orm import Session

from app.models.employee import AttendanceDaily, AttendanceRaw, Employee, Shift

logger = logging.getLogger(__name__)


def process_raw_punches(att_date: date, db: Session) -> dict:
    """
    For a given date, consolidate attendance_raw rows into attendance_daily.

    Groups punches by emp_code, picks first_in / last_out, computes hours_worked,
    matches the employee's shift for OT, and determines att_status.
    Single-punch records are flagged for HR review.

    Called by a daily cron job (Phase 2 — cron wiring not yet in place).
    """
    rows = (
        db.query(AttendanceRaw)
        .filter(cast(AttendanceRaw.punch_time, Date) == att_date)
        .order_by(AttendanceRaw.emp_code, AttendanceRaw.punch_time)
        .all()
    )

    by_emp: dict[str, list[AttendanceRaw]] = {}
    for row in rows:
        by_emp.setdefault(row.emp_code, []).append(row)

    processed = 0
    flagged = 0

    for emp_code, punches in by_emp.items():
        punches.sort(key=lambda p: p.punch_time)
        first_in = punches[0].punch_time
        single_punch = len(punches) == 1

        if single_punch:
            last_out = None
            hours_worked = 0.0
            remarks = "single_punch_flagged"
            flagged += 1
        else:
            last_out = punches[-1].punch_time
            hours_worked = round(
                (last_out - first_in).total_seconds() / 3600, 2
            )
            remarks = None

        if hours_worked >= 4:
            att_status = "present"
        elif hours_worked >= 2:
            att_status = "halfday"
        else:
            att_status = "absent"

        emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
        shift_id = emp.shift_id if emp else None
        location_id = emp.location_id if emp else None
        ot_hours = 0.0

        if emp and emp.shift_id and last_out:
            shift = db.query(Shift).filter(Shift.id == emp.shift_id).first()
            if shift:
                shift_start = datetime.combine(att_date, shift.in_time, tzinfo=timezone.utc)
                shift_end = datetime.combine(att_date, shift.out_time, tzinfo=timezone.utc)
                # Handle night shifts that cross midnight
                if shift_end <= shift_start:
                    shift_end += timedelta(days=1)
                shift_hours = (shift_end - shift_start).total_seconds() / 3600
                ot_hours = max(0.0, round(hours_worked - shift_hours, 2))

        existing = (
            db.query(AttendanceDaily)
            .filter(
                AttendanceDaily.emp_code == emp_code,
                AttendanceDaily.att_date == att_date,
            )
            .first()
        )

        if existing:
            existing.first_in = first_in
            existing.last_out = last_out
            existing.hours_worked = hours_worked
            existing.ot_hours = ot_hours
            existing.att_status = att_status
            existing.shift_id = shift_id
            existing.location_id = location_id
            existing.source = "biometric"
            existing.remarks = remarks
        else:
            db.add(AttendanceDaily(
                emp_code=emp_code,
                att_date=att_date,
                first_in=first_in,
                last_out=last_out,
                hours_worked=hours_worked,
                ot_hours=ot_hours,
                att_status=att_status,
                shift_id=shift_id,
                location_id=location_id,
                source="biometric",
                remarks=remarks,
            ))

        processed += 1

    db.commit()
    logger.info(
        "process_raw_punches: date=%s processed=%d flagged=%d",
        att_date, processed, flagged,
    )
    return {"date": str(att_date), "processed": processed, "flagged": flagged}
