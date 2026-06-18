from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.dependencies import require_role
from app.core.version import APP_VERSION
from app.models.employee import Employee, Entity, Loan, Location, PayrollMonth, User

router = APIRouter()


def _scope(db: Session, user: User) -> Optional[str]:
    if user.role == "super_admin":
        return None
    return db.query(Employee.entity_id).filter(Employee.emp_code == user.emp_code).scalar()


@router.get("/system-stats")
def system_stats(
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    """Live system counts. Entity-scoped for entity_admin, all entities for super_admin."""
    scope = _scope(db, current_user)

    emp_q = db.query(Employee)
    if scope is not None:
        emp_q = emp_q.filter(Employee.entity_id == scope)
    employees_total = emp_q.count()
    employees_active = emp_q.filter(Employee.status == "active").count()

    # Locations: group-wide rows (entity_id NULL) are visible to everyone.
    loc_q = db.query(Location).filter(Location.status == "active")
    if scope is not None:
        loc_q = loc_q.filter((Location.entity_id == scope) | (Location.entity_id.is_(None)))
    locations_active = loc_q.count()

    pm_q = db.query(PayrollMonth).join(Employee, Employee.emp_code == PayrollMonth.emp_code)
    if scope is not None:
        pm_q = pm_q.filter(Employee.entity_id == scope)
    payroll_months_processed = pm_q.filter(PayrollMonth.status == "processed").count()
    payroll_months_locked = pm_q.filter(PayrollMonth.status == "locked").count()

    loan_q = db.query(Loan).join(Employee, Employee.emp_code == Loan.emp_code).filter(Loan.status == "active")
    if scope is not None:
        loan_q = loan_q.filter(Employee.entity_id == scope)
    loans_active = loan_q.count()

    entities = 1 if scope is not None else db.query(Entity).count()

    db_table_count = db.execute(
        text("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
    ).scalar()

    return {
        "employees_total":          employees_total,
        "employees_active":         employees_active,
        "entities":                 entities,
        "locations_active":         locations_active,
        "payroll_months_processed": payroll_months_processed,
        "payroll_months_locked":    payroll_months_locked,
        "loans_active":             loans_active,
        "db_table_count":           db_table_count,
        "app_version":              APP_VERSION,
        "server_time":              datetime.now(timezone.utc).isoformat(),
    }
