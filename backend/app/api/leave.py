from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.dependencies import get_current_user, require_role
from app.models.employee import AuditLog, Employee, LeaveAccrualLog, LeaveBalance, LeaveRequest, PayrollMonth, User
from app.services.leave_engine import encash_pl, run_monthly_accrual

router = APIRouter()


class MonthlyAccrualBody(BaseModel):
    month: int
    year: int
    entity_id: Optional[str] = None


class EndProbationBody(BaseModel):
    extend_days: Optional[int] = None


class EncashPLBody(BaseModel):
    days: float


# ---------------------------------------------------------------------------
# POST /run-monthly-accrual
# ---------------------------------------------------------------------------

@router.post("/run-monthly-accrual")
def run_monthly_accrual_batch(
    body: MonthlyAccrualBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """Run monthly leave accrual for all active staff employees (optionally filtered by entity)."""
    q = db.query(Employee).filter(Employee.status == "active")

    if body.entity_id:
        if current_user.role != "super_admin":
            my_entity = (
                db.query(Employee.entity_id)
                .filter(Employee.emp_code == current_user.emp_code)
                .scalar()
            )
            if body.entity_id != my_entity:
                raise HTTPException(status_code=403, detail="Access denied")
        q = q.filter(Employee.entity_id == body.entity_id)
    elif current_user.role != "super_admin":
        my_entity = (
            db.query(Employee.entity_id)
            .filter(Employee.emp_code == current_user.emp_code)
            .scalar()
        )
        q = q.filter(Employee.entity_id == my_entity)

    employees = q.all()
    processed = skipped_probation = skipped_worker = already_processed = 0
    errors: list[dict] = []

    for emp in employees:
        try:
            result = run_monthly_accrual(emp.emp_code, body.month, body.year, db)
            db.flush()
            if result == "accrued":
                processed += 1
            elif result == "skipped_probation":
                skipped_probation += 1
            elif result == "skipped_worker":
                skipped_worker += 1
            elif result == "already_processed":
                already_processed += 1
        except HTTPException as exc:
            errors.append({"emp_code": emp.emp_code, "error": exc.detail})
        except Exception as exc:
            errors.append({"emp_code": emp.emp_code, "error": str(exc)})

    db.add(AuditLog(
        user_code=current_user.emp_code,
        action="LEAVE_ACCRUAL_BATCH",
        table_name="leave_balances",
        record_id="BATCH",
        new_values={
            "month": body.month,
            "year": body.year,
            "entity_id": body.entity_id,
            "processed": processed,
            "skipped_probation": skipped_probation,
            "skipped_worker": skipped_worker,
        },
    ))
    db.commit()

    return {
        "processed": processed,
        "skipped_probation": skipped_probation,
        "skipped_worker": skipped_worker,
        "already_processed": already_processed,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# POST /end-probation/{emp_code}
# ---------------------------------------------------------------------------

@router.post("/end-probation/{emp_code}")
def end_probation(
    emp_code: str,
    body: Optional[EndProbationBody] = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """
    Manually end probation for an employee, or extend it.
    - No body / empty body → end probation now.
    - {extend_days: N} → add N days to probation_days (max 180 total), do NOT end.
    """
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    today = date.today()

    if body and body.extend_days:
        new_days = (emp.probation_days or 90) + body.extend_days
        if new_days > 180:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot extend beyond 180 days (would be {new_days})",
            )
        emp.probation_days = new_days
        db.add(AuditLog(
            user_code=current_user.emp_code,
            action="PROBATION_EXTENDED",
            table_name="employees",
            record_id=emp_code,
            new_values={"probation_days": new_days, "extend_days": body.extend_days},
        ))
        db.commit()
        return {
            "message": f"Probation extended to {new_days} days",
            "probation_days": new_days,
            "emp_code": emp_code,
        }

    # End probation
    emp.is_on_probation = False
    emp.probation_end_date = today
    db.add(AuditLog(
        user_code=current_user.emp_code,
        action="PROBATION_ENDED",
        table_name="employees",
        record_id=emp_code,
        new_values={"probation_end_date": today.isoformat(), "trigger": "manual"},
    ))
    db.commit()
    return {
        "message": f"Probation ended for {emp_code}",
        "probation_end_date": today.isoformat(),
        "emp_code": emp_code,
    }


# ---------------------------------------------------------------------------
# GET /balance/{emp_code}
# ---------------------------------------------------------------------------

@router.get("/balance/{emp_code}")
def get_leave_balance(
    emp_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return leave balances for an employee. Employee sees only own; HR/admin sees any."""
    if current_user.role == "employee" and current_user.emp_code != emp_code:
        raise HTTPException(status_code=403, detail="Access denied")

    if current_user.role not in ("super_admin", "employee"):
        target_entity = (
            db.query(Employee.entity_id).filter(Employee.emp_code == emp_code).scalar()
        )
        my_entity = (
            db.query(Employee.entity_id)
            .filter(Employee.emp_code == current_user.emp_code)
            .scalar()
        )
        if target_entity != my_entity:
            raise HTTPException(status_code=403, detail="Access denied")

    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    rows = (
        db.query(LeaveBalance)
        .filter(LeaveBalance.emp_code == emp_code)
        .order_by(LeaveBalance.year.desc(), LeaveBalance.leave_type)
        .all()
    )

    result: dict = {}
    for lb in rows:
        lt = lb.leave_type
        if lt not in result:
            result[lt] = {
                "year": lb.year,
                "entitlement": float(lb.entitlement or 0),
                "used": float(lb.used or 0),
                "balance": float(lb.balance or 0),
                "carried_forward": float(lb.carried_forward or 0),
                "accrued_ytd": float(lb.accrued_ytd or 0),
                "taken_ytd": float(lb.taken_ytd or 0),
                "encashed_ytd": float(lb.encashed_ytd or 0),
            }

    # Compute daily rate and cash value of saved PL (basic / 26 per day)
    daily_rate = round(float(emp.basic or 0) / 26, 2)
    pl_balance = result.get("PL", {}).get("balance", 0.0)
    pl_cash_value = round(daily_rate * pl_balance, 2)

    # Service years (PL only credits after 1 year)
    today = date.today()
    service_years = int(((today - emp.doj).days // 365)) if emp.doj else 0

    result["_meta"] = {
        "category": emp.category or "staff",
        "is_on_probation": bool(emp.is_on_probation),
        "service_years": service_years,
        "daily_rate": daily_rate,
        "pl_cash_value": pl_cash_value,
        "pl_eligible": service_years >= 1,
    }
    return result


# ---------------------------------------------------------------------------
# POST /encash-pl/{emp_code}
# ---------------------------------------------------------------------------

@router.post("/encash-pl/{emp_code}")
def encash_pl_route(
    emp_code: str,
    body: EncashPLBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    return encash_pl(emp_code, body.days, db)


# ---------------------------------------------------------------------------
# GET /accrual-log/{emp_code}
# ---------------------------------------------------------------------------

@router.get("/accrual-log/{emp_code}")
def get_accrual_log(
    emp_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return leave_accrual_log for an employee, newest first."""
    if current_user.role == "employee" and current_user.emp_code != emp_code:
        raise HTTPException(status_code=403, detail="Access denied")

    rows = (
        db.query(LeaveAccrualLog)
        .filter(LeaveAccrualLog.emp_code == emp_code)
        .order_by(LeaveAccrualLog.id.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "leave_type": r.leave_type,
            "accrual_date": str(r.accrual_date),
            "days_credited": float(r.days_credited),
            "reason": r.reason,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# GET /streak/{emp_code}
# ---------------------------------------------------------------------------

@router.get("/streak/{emp_code}")
def get_leave_streak(
    emp_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return consecutive months with zero leave taken (for streak goal)."""
    if current_user.role == "employee" and current_user.emp_code != emp_code:
        raise HTTPException(status_code=403, detail="Access denied")

    STREAK_GOAL = 12
    rows = (
        db.query(PayrollMonth)
        .filter(PayrollMonth.emp_code == emp_code)
        .order_by(PayrollMonth.year.desc(), PayrollMonth.month.desc())
        .limit(STREAK_GOAL)
        .all()
    )

    streak_months = 0
    for row in rows:
        total_leave = (
            float(row.days_cl or 0)
            + float(row.days_sl or 0)
            + float(row.days_lwp or 0)
            + float(row.days_el or 0)
        )
        if total_leave == 0:
            streak_months += 1
        else:
            break

    return {
        "emp_code": emp_code,
        "streak_months": streak_months,
        "streak_goal": STREAK_GOAL,
        "streak_achieved": streak_months >= STREAK_GOAL,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _working_days(from_date: date, to_date: date) -> int:
    """Count Mon–Sat days between from_date and to_date inclusive (exclude Sundays)."""
    count = 0
    current = from_date
    while current <= to_date:
        if current.weekday() != 6:  # 6 = Sunday
            count += 1
        from datetime import timedelta
        current += timedelta(days=1)
    return count


def _get_entity(emp_code: str, db: Session) -> Optional[str]:
    return db.query(Employee.entity_id).filter(Employee.emp_code == emp_code).scalar()


def _check_entity_access(request_emp_code: str, current_user: User, db: Session):
    if current_user.role == "super_admin":
        return
    target_entity = _get_entity(request_emp_code, db)
    my_entity = _get_entity(current_user.emp_code, db)
    if target_entity != my_entity:
        raise HTTPException(status_code=403, detail="Access denied")


def _req_to_dict(r: LeaveRequest) -> dict:
    return {
        "id": r.id,
        "emp_code": r.emp_code,
        "leave_type": r.leave_type,
        "from_date": r.from_date.isoformat() if r.from_date else None,
        "to_date": r.to_date.isoformat() if r.to_date else None,
        "days": float(r.days),
        "reason": r.reason,
        "status": r.status,
        "approved_by": r.approved_by,
        "approved_at": r.approved_at.isoformat() if r.approved_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "emp_name": r.employee.name if r.employee else None,
    }


# ---------------------------------------------------------------------------
# POST /apply
# ---------------------------------------------------------------------------

class ApplyLeaveBody(BaseModel):
    leave_type: str
    from_date: date
    to_date: date
    reason: Optional[str] = None


@router.post("/apply")
def apply_leave(
    body: ApplyLeaveBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.leave_type not in ("CL", "SL", "PL"):
        raise HTTPException(status_code=400, detail="leave_type must be CL, SL, or PL")
    if body.from_date > body.to_date:
        raise HTTPException(status_code=400, detail="from_date must be on or before to_date")

    days = _working_days(body.from_date, body.to_date)
    if days == 0:
        raise HTTPException(status_code=400, detail="No working days in selected date range")

    today = date.today()
    emp = db.query(Employee).filter(Employee.emp_code == current_user.emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    if body.leave_type == "PL":
        service_years = ((today - emp.doj).days // 365) if emp.doj else 0
        if service_years < 1:
            raise HTTPException(status_code=400, detail="PL accrual starts after 1 year of service")

    lb = (
        db.query(LeaveBalance)
        .filter(
            LeaveBalance.emp_code == current_user.emp_code,
            LeaveBalance.leave_type == body.leave_type,
            LeaveBalance.year == body.from_date.year,
        )
        .first()
    )
    if not lb:
        raise HTTPException(status_code=400, detail=f"No leave balance found for {body.leave_type}")

    balance = float(lb.balance or 0)
    if balance < days:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient {body.leave_type} balance ({balance:.1f} days available, {days} requested)",
        )

    overlap = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.emp_code == current_user.emp_code,
            LeaveRequest.status.in_(["pending", "approved"]),
            LeaveRequest.from_date <= body.to_date,
            LeaveRequest.to_date >= body.from_date,
        )
        .first()
    )
    if overlap:
        raise HTTPException(status_code=400, detail="You already have a leave request overlapping these dates")

    req = LeaveRequest(
        emp_code=current_user.emp_code,
        leave_type=body.leave_type,
        from_date=body.from_date,
        to_date=body.to_date,
        days=days,
        reason=body.reason,
        status="pending",
        created_at=datetime.now(timezone.utc),
    )
    db.add(req)
    db.flush()

    db.add(AuditLog(
        user_code=current_user.emp_code,
        action="LEAVE_APPLY",
        table_name="leave_requests",
        record_id=str(req.id),
        new_values={
            "leave_type": body.leave_type,
            "from_date": body.from_date.isoformat(),
            "to_date": body.to_date.isoformat(),
            "days": days,
        },
    ))
    db.commit()
    db.refresh(req)
    return _req_to_dict(req)


# ---------------------------------------------------------------------------
# GET /my-requests
# ---------------------------------------------------------------------------

@router.get("/my-requests")
def my_leave_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.emp_code == current_user.emp_code)
        .order_by(LeaveRequest.created_at.desc())
        .limit(50)
        .all()
    )
    return [_req_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# GET /pending-count
# ---------------------------------------------------------------------------

@router.get("/pending-count")
def pending_leave_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    q = db.query(LeaveRequest).filter(LeaveRequest.status == "pending")
    if current_user.role != "super_admin":
        my_entity = _get_entity(current_user.emp_code, db)
        q = q.join(Employee, Employee.emp_code == LeaveRequest.emp_code).filter(
            Employee.entity_id == my_entity
        )
    return {"count": q.count()}


# ---------------------------------------------------------------------------
# GET /pending
# ---------------------------------------------------------------------------

@router.get("/pending")
def pending_leave_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    q = (
        db.query(LeaveRequest)
        .join(Employee, Employee.emp_code == LeaveRequest.emp_code)
        .filter(LeaveRequest.status == "pending")
    )
    if current_user.role != "super_admin":
        my_entity = _get_entity(current_user.emp_code, db)
        q = q.filter(Employee.entity_id == my_entity)
    rows = q.order_by(LeaveRequest.created_at.asc()).all()
    return [_req_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# PUT /approve/{request_id}
# ---------------------------------------------------------------------------

@router.put("/approve/{request_id}")
def approve_leave(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {req.status}")

    _check_entity_access(req.emp_code, current_user, db)

    lb = (
        db.query(LeaveBalance)
        .filter(
            LeaveBalance.emp_code == req.emp_code,
            LeaveBalance.leave_type == req.leave_type,
            LeaveBalance.year == req.from_date.year,
        )
        .first()
    )
    if not lb:
        raise HTTPException(status_code=400, detail="Leave balance record not found")

    lb.taken_ytd = float(lb.taken_ytd or 0) + float(req.days)
    lb.used = float(lb.used or 0) + float(req.days)
    # balance is GENERATED ALWAYS AS (entitlement - used) — never write it directly

    req.status = "approved"
    req.approved_by = current_user.emp_code
    req.approved_at = datetime.now(timezone.utc)

    db.add(AuditLog(
        user_code=current_user.emp_code,
        action="LEAVE_APPROVE",
        table_name="leave_requests",
        record_id=str(req.id),
        new_values={"emp_code": req.emp_code, "leave_type": req.leave_type, "days": float(req.days)},
    ))
    db.commit()
    return {"message": "Approved", "id": request_id}


# ---------------------------------------------------------------------------
# PUT /reject/{request_id}
# ---------------------------------------------------------------------------

class RejectLeaveBody(BaseModel):
    reason: Optional[str] = None


@router.put("/reject/{request_id}")
def reject_leave(
    request_id: int,
    body: RejectLeaveBody = Body(default=RejectLeaveBody()),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {req.status}")

    _check_entity_access(req.emp_code, current_user, db)

    if body.reason:
        existing = req.reason or ""
        req.reason = f"{existing}\n[Rejected: {body.reason}]".strip()

    req.status = "rejected"
    req.approved_by = current_user.emp_code
    req.approved_at = datetime.now(timezone.utc)

    db.add(AuditLog(
        user_code=current_user.emp_code,
        action="LEAVE_REJECT",
        table_name="leave_requests",
        record_id=str(req.id),
        new_values={"emp_code": req.emp_code, "reason": body.reason},
    ))
    db.commit()
    return {"message": "Rejected", "id": request_id}


# ---------------------------------------------------------------------------
# PUT /cancel/{request_id}
# ---------------------------------------------------------------------------

@router.put("/cancel/{request_id}")
def cancel_leave(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req.emp_code != current_user.emp_code:
        raise HTTPException(status_code=403, detail="Access denied")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending requests can be cancelled")

    req.status = "cancelled"

    db.add(AuditLog(
        user_code=current_user.emp_code,
        action="LEAVE_CANCEL",
        table_name="leave_requests",
        record_id=str(req.id),
        new_values={"emp_code": req.emp_code},
    ))
    db.commit()
    return {"message": "Cancelled"}


# ---------------------------------------------------------------------------
# GET /tracker  — admin leave overview for all employees
# ---------------------------------------------------------------------------

@router.get("/tracker")
def leave_tracker(
    entity_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    """Return leave balance + encashment value + streak for every active employee in the entity."""
    from datetime import timedelta

    STREAK_GOAL = 12
    year = date.today().year
    today = date.today()

    # Resolve entity scope
    if current_user.role == "super_admin":
        scope_entity = entity_id  # None → show all
    else:
        scope_entity = _get_entity(current_user.emp_code, db)

    q = db.query(Employee).filter(Employee.status == "active")
    if scope_entity:
        q = q.filter(Employee.entity_id == scope_entity)
    employees = q.order_by(Employee.entity_id, Employee.name).all()
    emp_codes = [e.emp_code for e in employees]

    if not emp_codes:
        return {"employees": [], "total": 0, "year": year}

    # Leave balances for current year
    bal_rows = db.query(LeaveBalance).filter(
        LeaveBalance.emp_code.in_(emp_codes),
        LeaveBalance.year == year,
    ).all()
    bal_map: dict = {}
    for b in bal_rows:
        bal_map.setdefault(b.emp_code, {})[b.leave_type] = b

    # Payroll months for streak (last STREAK_GOAL months per employee)
    pm_rows = (
        db.query(PayrollMonth)
        .filter(PayrollMonth.emp_code.in_(emp_codes))
        .order_by(PayrollMonth.year.desc(), PayrollMonth.month.desc())
        .all()
    )
    pm_map: dict = {}
    for pm in pm_rows:
        bucket = pm_map.setdefault(pm.emp_code, [])
        if len(bucket) < STREAK_GOAL:
            bucket.append(pm)

    def _streak(pms) -> int:
        s = 0
        for pm in pms:
            if (float(pm.days_cl or 0) + float(pm.days_sl or 0)
                    + float(pm.days_lwp or 0) + float(pm.days_el or 0)) == 0:
                s += 1
            else:
                break
        return s

    result = []
    for emp in employees:
        emp_bal = bal_map.get(emp.emp_code, {})
        cl = emp_bal.get("CL")
        sl = emp_bal.get("SL")
        pl = emp_bal.get("PL")

        daily_rate   = round(float(emp.basic or 0) / 26, 2)
        pl_balance   = float(pl.balance) if pl else 0.0
        pl_encashed  = float(pl.encashed_ytd) if pl else 0.0
        pl_cash_val  = round(daily_rate * pl_balance, 2)
        service_yrs  = int((today - emp.doj).days // 365) if emp.doj else 0
        streak       = _streak(pm_map.get(emp.emp_code, []))

        result.append({
            "emp_code":       emp.emp_code,
            "name":           emp.name,
            "entity_id":      emp.entity_id,
            "category":       emp.category,
            "is_on_probation": bool(emp.is_on_probation),
            "service_years":  service_yrs,
            "basic":          float(emp.basic or 0),
            "daily_rate":     daily_rate,
            "CL": {
                "balance":     float(cl.balance) if cl else 0,
                "used":        float(cl.taken_ytd) if cl else 0,
                "entitlement": float(cl.entitlement) if cl else 0,
            },
            "SL": {
                "balance":     float(sl.balance) if sl else 0,
                "used":        float(sl.taken_ytd) if sl else 0,
                "entitlement": float(sl.entitlement) if sl else 0,
            },
            "PL": {
                "balance":      pl_balance,
                "used":         float(pl.taken_ytd) if pl else 0,
                "encashed_ytd": pl_encashed,
            },
            "pl_cash_value":   pl_cash_val,
            "pl_eligible":     service_yrs >= 1,
            "streak_months":   streak,
            "streak_goal":     STREAK_GOAL,
            "streak_achieved": streak >= STREAK_GOAL,
        })

    return {"employees": result, "total": len(result), "year": year}

# ===========================================================================
# NEW LEAVE REQUEST MANAGEMENT (Part F — Session 13.14)
# Routes: /request, /requests, /request/{id}/approve, /request/{id}/reject,
#         /requests/pending-count
# ===========================================================================


class LeaveRequestBody(BaseModel):
    emp_code: str
    leave_type: str
    from_date: date
    to_date: date
    reason: Optional[str] = None


class RejectRequestBody(BaseModel):
    reason: Optional[str] = None


def _req_to_dict_v2(r: LeaveRequest, emp_name: Optional[str] = None) -> dict:
    return {
        "id":          r.id,
        "emp_code":    r.emp_code,
        "emp_name":    emp_name or (r.employee.name if r.employee else None),
        "entity_id":   r.entity_id,
        "leave_type":  r.leave_type,
        "from_date":   r.from_date.isoformat() if r.from_date else None,
        "to_date":     r.to_date.isoformat() if r.to_date else None,
        "days":        int(r.days),
        "reason":      r.reason,
        "status":      r.status,
        "applied_on":  r.applied_on.isoformat() if r.applied_on else (
                           r.created_at.isoformat() if r.created_at else None),
        "actioned_by": r.actioned_by,
        "actioned_on": r.actioned_on.isoformat() if r.actioned_on else None,
        "reject_note": r.reject_note,
    }


# ---------------------------------------------------------------------------
# POST /request  — apply for leave
# ---------------------------------------------------------------------------

@router.post("/request", status_code=201)
def create_leave_request(
    body: LeaveRequestBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Employees can only apply for themselves
    if current_user.role == "employee" and body.emp_code != current_user.emp_code:
        raise HTTPException(status_code=403, detail="Access denied")

    if body.leave_type not in ("CL", "SL", "EL", "PL"):
        raise HTTPException(status_code=400, detail="leave_type must be CL, SL, EL, or PL")
    if body.from_date > body.to_date:
        raise HTTPException(status_code=400, detail="from_date must be on or before to_date")

    emp = db.query(Employee).filter(Employee.emp_code == body.emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    if emp.is_on_probation:
        raise HTTPException(
            status_code=400,
            detail="Employees on probation are not eligible for leave",
        )
    if (emp.category or "staff") == "worker":
        raise HTTPException(
            status_code=400,
            detail="Worker category employees are not eligible for leave",
        )

    days = (body.to_date - body.from_date).days + 1

    # Balance check
    lb = (
        db.query(LeaveBalance)
        .filter(
            LeaveBalance.emp_code == body.emp_code,
            LeaveBalance.leave_type == body.leave_type,
            LeaveBalance.year == body.from_date.year,
        )
        .first()
    )
    if not lb:
        raise HTTPException(
            status_code=400,
            detail=f"No {body.leave_type} balance record found for {body.from_date.year}",
        )
    available = float(lb.balance or 0)
    if available < days:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient {body.leave_type} balance. Available: {available:.1f} days",
        )

    # Overlap check
    overlap = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.emp_code == body.emp_code,
            LeaveRequest.status.in_(["pending", "approved"]),
            LeaveRequest.from_date <= body.to_date,
            LeaveRequest.to_date >= body.from_date,
        )
        .first()
    )
    if overlap:
        raise HTTPException(status_code=400, detail="Overlapping leave request exists")

    now = datetime.now(timezone.utc)
    req = LeaveRequest(
        emp_code   = body.emp_code,
        entity_id  = emp.entity_id,
        leave_type = body.leave_type,
        from_date  = body.from_date,
        to_date    = body.to_date,
        days       = days,
        reason     = body.reason,
        status     = "pending",
        applied_on = now,
        created_at = now,
    )
    db.add(req)
    db.flush()

    db.add(AuditLog(
        user_code  = current_user.emp_code,
        action     = "CREATE",
        table_name = "leave_requests",
        record_id  = str(req.id),
        new_values = {
            "emp_code":   body.emp_code,
            "leave_type": body.leave_type,
            "from_date":  body.from_date.isoformat(),
            "to_date":    body.to_date.isoformat(),
            "days":       days,
        },
    ))
    db.commit()
    db.refresh(req)
    return _req_to_dict_v2(req)


# ---------------------------------------------------------------------------
# GET /requests  — list with filters
# ---------------------------------------------------------------------------

@router.get("/requests")
def list_leave_requests(
    emp_code:  Optional[str] = None,
    entity_id: Optional[str] = None,
    status:    Optional[str] = None,
    from_date: Optional[date] = None,
    to_date:   Optional[date] = None,
    page:      int = 1,
    page_size: int = 50,
    db:        Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy.orm import joinedload

    q = db.query(LeaveRequest).options(joinedload(LeaveRequest.employee))

    # Scope enforcement
    if current_user.role == "employee":
        q = q.filter(LeaveRequest.emp_code == current_user.emp_code)
    elif current_user.role != "super_admin":
        my_entity = _get_entity(current_user.emp_code, db)
        q = q.filter(LeaveRequest.entity_id == my_entity)
        if entity_id and entity_id != my_entity:
            raise HTTPException(status_code=403, detail="Access denied")

    # Filters
    if emp_code:
        q = q.filter(LeaveRequest.emp_code == emp_code)
    if entity_id and current_user.role == "super_admin":
        q = q.filter(LeaveRequest.entity_id == entity_id)
    if status:
        q = q.filter(LeaveRequest.status == status)
    if from_date:
        q = q.filter(LeaveRequest.from_date >= from_date)
    if to_date:
        q = q.filter(LeaveRequest.to_date <= to_date)

    total = q.count()
    rows = (
        q.order_by(LeaveRequest.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "items":     [_req_to_dict_v2(r, r.employee.name if r.employee else None) for r in rows],
    }


# ---------------------------------------------------------------------------
# PUT /request/{id}/approve
# ---------------------------------------------------------------------------

@router.put("/request/{request_id}/approve")
def approve_leave_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req.status in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail=f"Request is already {req.status}")
    if current_user.role != "super_admin":
        my_entity = _get_entity(current_user.emp_code, db)
        if req.entity_id and req.entity_id != my_entity:
            raise HTTPException(status_code=403, detail="Access denied")
    if req.emp_code == current_user.emp_code:
        raise HTTPException(status_code=400, detail="Cannot approve your own leave request")

    now = datetime.now(timezone.utc)
    req.status      = "approved"
    req.actioned_by = current_user.emp_code
    req.actioned_on = now
    # keep legacy field in sync
    req.approved_by = current_user.emp_code
    req.approved_at = now

    db.add(AuditLog(
        user_code  = current_user.emp_code,
        action     = "UPDATE",
        table_name = "leave_requests",
        record_id  = str(request_id),
        new_values = {"status": "approved", "actioned_by": current_user.emp_code},
    ))
    db.commit()
    return {"status": "approved", "id": request_id}


# ---------------------------------------------------------------------------
# PUT /request/{id}/reject
# ---------------------------------------------------------------------------

@router.put("/request/{request_id}/reject")
def reject_leave_request(
    request_id: int,
    body: RejectRequestBody = Body(default=RejectRequestBody()),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req.status in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail=f"Request is already {req.status}")
    if current_user.role != "super_admin":
        my_entity = _get_entity(current_user.emp_code, db)
        if req.entity_id and req.entity_id != my_entity:
            raise HTTPException(status_code=403, detail="Access denied")

    now = datetime.now(timezone.utc)
    req.status      = "rejected"
    req.actioned_by = current_user.emp_code
    req.actioned_on = now
    req.reject_note = body.reason
    req.approved_by = current_user.emp_code
    req.approved_at = now

    db.add(AuditLog(
        user_code  = current_user.emp_code,
        action     = "UPDATE",
        table_name = "leave_requests",
        record_id  = str(request_id),
        new_values = {"status": "rejected", "reject_note": body.reason},
    ))
    db.commit()
    return {"status": "rejected", "id": request_id}


# ---------------------------------------------------------------------------
# GET /requests/pending-count
# ---------------------------------------------------------------------------

@router.get("/requests/pending-count")
def requests_pending_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    q = db.query(LeaveRequest).filter(LeaveRequest.status == "pending")
    if current_user.role != "super_admin":
        my_entity = _get_entity(current_user.emp_code, db)
        q = q.filter(LeaveRequest.entity_id == my_entity)
    return {"count": q.count()}
