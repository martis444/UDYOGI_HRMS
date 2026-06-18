"""
Resolve which salary structure applied to an employee during a payroll period.
Period is computed by period_calculator (26th prev month -> 25th current month).

Increments always take effect from a payroll-cycle boundary (the 26th), so a
single structure covers an entire period -- there is never within-period
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
    (year, month). Since increments align to cycle boundaries, exactly one
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
