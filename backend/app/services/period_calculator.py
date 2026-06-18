"""
Pay period: the full calendar month (1st → last day).
Example: payroll_year=2026, payroll_month=4 (April)
  → period_start = 2026-04-01
  → period_end   = 2026-04-30

Salary is paid on the 26th, but the period it covers is the calendar month, and
salary increments take effect from the 1st of a month (see increment_service).

Working days for a location = all days in period
  minus Sundays (weekday() == 6)
  minus mandatory public holidays (is_restricted=FALSE) where
        location_id = employee's location_id OR location_id IS NULL
"""

import calendar
from datetime import date, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.employee import PublicHoliday


def get_period_dates(year: int, month: int) -> tuple[date, date]:
    last_day = calendar.monthrange(year, month)[1]
    period_start = date(year, month, 1)
    period_end = date(year, month, last_day)
    return period_start, period_end


def _all_days_in_period(period_start: date, period_end: date) -> list[date]:
    days: list[date] = []
    cur = period_start
    while cur <= period_end:
        days.append(cur)
        cur += timedelta(days=1)
    return days


def get_holiday_dates(
    db: Session, all_days: list[date], location_id: str
) -> set[date]:
    """Mandatory (non-restricted) holidays for a given location within the supplied day list."""
    rows = (
        db.query(PublicHoliday)
        .filter(
            PublicHoliday.is_restricted == False,  # noqa: E712
            PublicHoliday.date.in_(all_days),
            or_(
                PublicHoliday.location_id == location_id,
                PublicHoliday.location_id == None,  # noqa: E711
            ),
        )
        .all()
    )
    return {r.date for r in rows}


def get_working_days_info(
    db: Session, year: int, month: int, location_id: str
) -> dict:
    """
    Returns:
      period_start, period_end,
      all_days (list), sundays (set), holidays (set),
      working_days (list), total_working_days (int)
    """
    period_start, period_end = get_period_dates(year, month)
    all_days = _all_days_in_period(period_start, period_end)
    sundays = {d for d in all_days if d.weekday() == 6}
    holidays = get_holiday_dates(db, all_days, location_id)
    working_days = [d for d in all_days if d not in sundays and d not in holidays]
    return {
        "period_start":       period_start,
        "period_end":         period_end,
        "all_days":           all_days,
        "sundays":            sundays,
        "holidays":           holidays,
        "working_days":       working_days,
        "total_working_days": len(working_days),
    }
