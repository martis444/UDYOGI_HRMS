"""
Resolve which salary structure applied to an employee during a payroll period.
Period is computed by period_calculator (the full calendar month, 1st -> last).

Increments always take effect from the 1st of a month, so a single structure
covers an entire calendar-month period -- there is never within-period
proration of two rates.
"""

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.employee import SalaryStructure
from app.services.period_calculator import get_period_dates


def get_structure_for_period(
    db: Session, emp_code: str, year: int, month: int
) -> SalaryStructure | None:
    """
    Returns the salary structure effective during the payroll period for
    (year, month). Since increments align to the 1st of a month, exactly one
    structure covers the whole period. Returns None for pre-history employees.
    """
    period_start, period_end = get_period_dates(year, month)
    return (
        db.query(SalaryStructure)
        .filter(
            SalaryStructure.emp_code == emp_code,
            SalaryStructure.effective_from <= period_end,
            or_(
                SalaryStructure.effective_to == None,  # noqa: E711
                SalaryStructure.effective_to >= period_start,
            ),
        )
        .order_by(SalaryStructure.effective_from.desc())
        .first()
    )


def get_active_structure(db: Session, emp_code: str) -> SalaryStructure | None:
    """The currently-active structure (effective_to IS NULL) for an employee."""
    return (
        db.query(SalaryStructure)
        .filter(
            SalaryStructure.emp_code == emp_code,
            SalaryStructure.effective_to == None,  # noqa: E711
        )
        .first()
    )
