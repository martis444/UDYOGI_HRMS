from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.dependencies import get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
    verify_token,
)
from app.models.employee import AuditLog, Employee, User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    TokenResponse,
)

router = APIRouter()


def _audit(db: Session, *, user_code: str, action: str, record_id: str, ip: str | None) -> None:
    db.add(AuditLog(
        user_code=user_code,
        action=action,
        table_name="users",
        record_id=record_id,
        ip_address=ip,
    ))


@router.post("/login")
def login(body: LoginRequest, req: Request, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .filter(User.emp_code == body.emp_code, User.is_active == True)
        .first()
    )
    # Uniform 401 — don't reveal whether emp_code exists
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    employee = db.query(Employee).filter(Employee.emp_code == body.emp_code).first()
    ip = req.client.host if req.client else None

    token_data = {
        "sub": user.emp_code,
        "role": user.role,
        "entity_id": employee.entity_id,
    }
    access_token = create_access_token(token_data)

    _audit(db, user_code=user.emp_code, action="LOGIN", record_id=user.emp_code, ip=ip)

    if user.is_first_login:
        db.commit()
        return {
            "force_reset": True,
            "message": "Password change required",
            "access_token": access_token,
        }

    refresh_token = create_refresh_token(token_data)
    user.last_login = datetime.now(timezone.utc)
    db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        emp_code=user.emp_code,
        role=user.role,
        entity_id=employee.entity_id,
        name=employee.name,
        is_first_login=False,
    )


@router.post("/refresh")
def refresh(body: RefreshRequest):
    payload = verify_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )
    new_access_token = create_access_token({
        "sub": payload["sub"],
        "role": payload["role"],
        "entity_id": payload["entity_id"],
    })
    return {"access_token": new_access_token, "token_type": "bearer"}


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    req: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    if body.new_password == body.current_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must differ from current password")

    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match")

    if len(body.new_password) < 8 or not any(c.isdigit() for c in body.new_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters and contain a number",
        )

    current_user.password_hash = hash_password(body.new_password)
    current_user.is_first_login = False

    ip = req.client.host if req.client else None
    _audit(db, user_code=current_user.emp_code, action="CHANGE_PASSWORD", record_id=current_user.emp_code, ip=ip)
    db.commit()

    return {"message": "Password updated successfully"}
