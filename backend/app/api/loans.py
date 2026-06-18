from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.employee import AuditLog, Employee, Loan, LoanEmiSchedule, User
from app.services.loan_service import create_loan, set_month_override

router = APIRouter()


def _actor_entity(db: Session, user: User) -> Optional[str]:
    if user.role == "super_admin":
        return None
    return db.query(Employee.entity_id).filter(Employee.emp_code == user.emp_code).scalar()


def _serialize(loan: Loan, name: Optional[str] = None) -> dict:
    return {
        "id":            loan.id,
        "emp_code":      loan.emp_code,
        "name":          name,
        "loan_type":     loan.loan_type,
        "principal":     float(loan.principal),
        "emi":           float(loan.emi),
        "outstanding":   float(loan.outstanding),
        "tenure_months": loan.tenure_months,
        "start_date":    loan.start_date.isoformat() if loan.start_date else None,
        "end_date":      loan.end_date.isoformat() if loan.end_date else None,
        "status":        loan.status,
        "remarks":       loan.remarks,
    }


def _sched(r: LoanEmiSchedule) -> dict:
    return {
        "year": r.year, "month": r.month,
        "scheduled_emi": float(r.scheduled_emi), "actual_emi": float(r.actual_emi),
        "is_overridden": r.is_overridden, "override_reason": r.override_reason,
        "overridden_by": r.overridden_by, "applied": r.applied,
    }


def _assert_loan_access(db: Session, user: User, loan: Loan) -> None:
    if user.role == "super_admin":
        return
    if user.role == "employee":
        if loan.emp_code != user.emp_code:
            raise HTTPException(status_code=403, detail="Access denied")
        return
    # entity_admin
    ent = db.query(Employee.entity_id).filter(Employee.emp_code == loan.emp_code).scalar()
    if ent != _actor_entity(db, user):
        raise HTTPException(status_code=403, detail="Access denied for this entity")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class LoanCreate(BaseModel):
    emp_code: str
    loan_type: str = "loan"
    principal: float
    emi: float
    tenure_months: int
    start_date: date
    remarks: Optional[str] = None


class LoanUpdate(BaseModel):
    emi: Optional[float] = None
    tenure_months: Optional[int] = None
    status: Optional[str] = None
    remarks: Optional[str] = None
    principal: Optional[float] = None


class OverrideBody(BaseModel):
    year: int
    month: int
    emi: float
    reason: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("")
def list_loans(
    entity_id: Optional[str] = Query(None),
    emp_code: Optional[str] = Query(None),
    status_f: Optional[str] = Query(None, alias="status"),
    loan_type: Optional[str] = Query(None, alias="type"),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    q = db.query(Loan, Employee.name).join(Employee, Employee.emp_code == Loan.emp_code)
    scope = _actor_entity(db, current_user)
    if scope is not None:
        q = q.filter(Employee.entity_id == scope)
    elif entity_id:
        q = q.filter(Employee.entity_id == entity_id)
    if emp_code:
        q = q.filter(Loan.emp_code == emp_code)
    if status_f:
        q = q.filter(Loan.status == status_f)
    if loan_type:
        q = q.filter(Loan.loan_type == loan_type)
    rows = q.order_by(Loan.id.desc()).all()
    return {"loans": [_serialize(loan, name) for loan, name in rows]}


@router.get("/{loan_id}")
def get_loan(
    loan_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    loan = db.get(Loan, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    _assert_loan_access(db, current_user, loan)
    name = db.query(Employee.name).filter(Employee.emp_code == loan.emp_code).scalar()
    sched = (
        db.query(LoanEmiSchedule)
        .filter(LoanEmiSchedule.loan_id == loan_id)
        .order_by(LoanEmiSchedule.year, LoanEmiSchedule.month)
        .all()
    )
    return {**_serialize(loan, name), "schedule": [_sched(s) for s in sched]}


@router.get("/employee/{emp}")
def get_employee_loans(
    emp: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role == "employee" and current_user.emp_code != emp:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == "entity_admin":
        ent = db.query(Employee.entity_id).filter(Employee.emp_code == emp).scalar()
        if ent != _actor_entity(db, current_user):
            raise HTTPException(status_code=403, detail="Access denied for this entity")
    rows = db.query(Loan).filter(Loan.emp_code == emp).order_by(Loan.id.desc()).all()
    name = db.query(Employee.name).filter(Employee.emp_code == emp).scalar()
    return {"loans": [_serialize(l, name) for l in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_loan_endpoint(
    body: LoanCreate,
    req: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    emp = db.query(Employee).filter(Employee.emp_code == body.emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    if emp.status != "active":
        raise HTTPException(status_code=400, detail="Employee is not active")
    scope = _actor_entity(db, current_user)
    if scope is not None and emp.entity_id != scope:
        raise HTTPException(status_code=403, detail="Access denied for this entity")
    if body.principal <= 0 or body.emi <= 0 or body.tenure_months <= 0:
        raise HTTPException(status_code=400, detail="principal, emi and tenure must be > 0")

    loan = create_loan(
        emp_code=body.emp_code, loan_type=body.loan_type, principal=body.principal,
        emi=body.emi, tenure_months=body.tenure_months, start_date=body.start_date,
        remarks=body.remarks, actor=current_user.emp_code, db=db,
    )
    db.commit()
    db.refresh(loan)
    return _serialize(loan, emp.name)


@router.put("/{loan_id}")
def update_loan(
    loan_id: int,
    body: LoanUpdate,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    loan = db.get(Loan, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    _assert_loan_access(db, current_user, loan)

    applied_exists = (
        db.query(LoanEmiSchedule)
        .filter(LoanEmiSchedule.loan_id == loan_id, LoanEmiSchedule.applied == True)  # noqa: E712
        .count() > 0
    )
    old = _serialize(loan)
    data = body.model_dump(exclude_none=True)

    if "principal" in data:
        if applied_exists:
            raise HTTPException(status_code=400, detail="Cannot change principal once an EMI has been applied")
        if data["principal"] <= 0:
            raise HTTPException(status_code=400, detail="principal must be > 0")
        loan.principal = data["principal"]
        loan.outstanding = data["principal"]  # no EMIs applied yet → reset balance
    if "status" in data:
        if data["status"] not in ("active", "paused", "closed", "written_off"):
            raise HTTPException(status_code=400, detail="invalid status")
        loan.status = data["status"]
    if "emi" in data:
        if data["emi"] <= 0:
            raise HTTPException(status_code=400, detail="emi must be > 0")
        loan.emi = data["emi"]
    if "tenure_months" in data:
        if data["tenure_months"] <= 0:
            raise HTTPException(status_code=400, detail="tenure must be > 0")
        loan.tenure_months = data["tenure_months"]
    if "remarks" in data:
        loan.remarks = data["remarks"]

    db.add(AuditLog(user_code=current_user.emp_code, action="LOAN_UPDATE",
                    table_name="loans", record_id=str(loan_id),
                    old_values=old, new_values=_serialize(loan)))
    db.commit()
    db.refresh(loan)
    return _serialize(loan)


@router.post("/{loan_id}/override")
def override_loan_emi(
    loan_id: int,
    body: OverrideBody,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    loan = db.get(Loan, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    _assert_loan_access(db, current_user, loan)
    if not body.reason or len(body.reason.strip()) < 4:
        raise HTTPException(status_code=400, detail="A reason of at least 4 characters is required")
    try:
        row = set_month_override(loan_id, body.year, body.month, body.emi,
                                 body.reason.strip(), current_user.emp_code, db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    return _sched(row)


@router.post("/{loan_id}/close")
def close_loan(
    loan_id: int,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    loan = db.get(Loan, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    _assert_loan_access(db, current_user, loan)
    old = loan.status
    loan.status = "closed"
    db.add(AuditLog(user_code=current_user.emp_code, action="LOAN_CLOSE",
                    table_name="loans", record_id=str(loan_id),
                    old_values={"status": old}, new_values={"status": "closed"}))
    db.commit()
    return _serialize(loan)
