import csv
import io
import random
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.db import get_db
from app.core.dependencies import get_current_user, require_role
from app.core.security import hash_password
from app.models.employee import (
    AuditLog, Department, Employee, Entity, Grade, Location, PublicHoliday, Shift, StatutoryConfig, User,
)

router = APIRouter()

_SALARY_FIELDS = {"basic", "hra", "spl", "cca"}

ALLOWED_COLUMNS = [
    "department_id", "grade_id", "shift_id", "designation",
    "location_id", "reporting_mgr_code", "basic", "hra",
    "spl", "cca", "ctc_annual", "bank_name", "ifsc", "bank_branch",
]
_ALLOWED_SET = set(ALLOWED_COLUMNS)
_LOCKED_SET = {"emp_code", "pan", "aadhaar_enc", "bank_acc_enc", "entity_id"}
_NUMERIC_COLS = {"basic", "hra", "spl", "cca", "ctc_annual"}
_INT_COLS = {"department_id", "grade_id", "shift_id"}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ColumnTemplateBody(BaseModel):
    columns: list[str]
    entity_id: str


class ColumnChange(BaseModel):
    column: str
    old_value: Optional[str] = None
    new_value: str


class EmployeeColumnChanges(BaseModel):
    emp_code: str
    changes: list[ColumnChange]


class ColumnCommitBody(BaseModel):
    change_set: list[EmployeeColumnChanges]


class ResetPasswordBody(BaseModel):
    emp_code: str


class StatutoryUpdateBody(BaseModel):
    gross_from: Optional[Decimal] = None
    gross_to: Optional[Decimal] = None
    monthly_amount: Optional[Decimal] = None
    feb_override: Optional[Decimal] = None
    annual_cap: Optional[Decimal] = None
    filing_freq: Optional[str] = None
    due_day: Optional[int] = None
    penalty_desc: Optional[str] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _audit(
    db: Session,
    *,
    user_code: str,
    action: str,
    record_id: str,
    table_name: str = "employees",
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    ip: Optional[str] = None,
) -> None:
    db.add(AuditLog(
        user_code=user_code,
        action=action,
        table_name=table_name,
        record_id=record_id,
        old_values=old_values,
        new_values=new_values,
        ip_address=ip,
    ))


def _actor_entity_id(current_user: User) -> Optional[str]:
    if current_user.role == "super_admin":
        return None
    return current_user.employee.entity_id


def _assert_entity_access(current_user: User, target_entity_id: str) -> None:
    actor = _actor_entity_id(current_user)
    if actor is not None and actor != target_entity_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for this entity")


def _mask_aadhaar(plain: Optional[str]) -> Optional[str]:
    if not plain:
        return None
    digits = re.sub(r"\D", "", plain)
    return f"XXXX XXXX {digits[-4:]}" if len(digits) >= 4 else "XXXX XXXX XXXX"


def _pgp_decrypt(db: Session, ciphertext: bytes) -> Optional[str]:
    if ciphertext is None:
        return None
    return db.execute(
        select(func.pgp_sym_decrypt(ciphertext, settings.ENCRYPTION_KEY))
    ).scalar()


def _compute_gross(*values) -> Decimal:
    return sum(Decimal(str(v)) for v in values if v is not None)


def _build_master_row(emp: Employee, db: Session) -> dict:
    aadhaar_plain = _pgp_decrypt(db, emp.aadhaar_enc)
    gross = _compute_gross(emp.basic, emp.hra, emp.spl, emp.cca)
    return {
        "emp_code": emp.emp_code,
        "legacy_code": emp.legacy_code,
        "name": emp.name,
        "father_name": emp.father_name,
        "dob": emp.dob,
        "gender": emp.gender,
        "marital_status": emp.marital_status,
        "blood_group": emp.blood_group,
        "religion": emp.religion,
        "mobile": emp.mobile,
        "email": emp.email,
        "doj": emp.doj,
        "entity_id": emp.entity_id,
        "location_id": emp.location_id,
        "location_city": emp.location.city if emp.location else None,
        "location_state": emp.location.state if emp.location else None,
        "department_id": emp.department_id,
        "department": emp.department.name if emp.department else None,
        "division": emp.division,
        "designation": emp.designation,
        "grade_id": emp.grade_id,
        "grade": emp.grade.code if emp.grade else None,
        "reporting_mgr_code": emp.reporting_mgr_code,
        "shift_id": emp.shift_id,
        "ctc_annual": emp.ctc_annual,
        "basic": emp.basic,
        "hra": emp.hra,
        "spl": emp.spl,
        "cca": emp.cca,
        "monthly_gross": gross,
        "pf_applicable": emp.pf_applicable,
        "esic_applicable": emp.esic_applicable,
        "pt_applicable": emp.pt_applicable,
        "pan": emp.pan,
        "aadhaar": _mask_aadhaar(aadhaar_plain),
        "uan": emp.uan,
        "esic_no": emp.esic_no,
        "bank_name": emp.bank_name,
        "ifsc": emp.ifsc,
        "bank_branch": emp.bank_branch,
        "present_addr": emp.present_addr,
        "present_city": emp.present_city,
        "present_state": emp.present_state,
        "present_pin": emp.present_pin,
        "perm_addr": emp.perm_addr,
        "perm_city": emp.perm_city,
        "perm_state": emp.perm_state,
        "perm_pin": emp.perm_pin,
        "status": emp.status,
        "exit_date": emp.exit_date,
        "created_at": emp.created_at,
        "updated_at": emp.updated_at,
        "created_by": emp.created_by,
    }


def _build_emp_query(
    db: Session,
    current_user: User,
    entity_id: Optional[str],
    location_id: Optional[str],
    department: Optional[str],
    emp_status: Optional[str],
    search: Optional[str],
):
    q = (
        db.query(Employee)
        .options(
            joinedload(Employee.location),
            joinedload(Employee.department),
            joinedload(Employee.grade),
        )
    )
    actor_entity = _actor_entity_id(current_user)
    if actor_entity is not None:
        q = q.filter(Employee.entity_id == actor_entity)
    elif entity_id:
        q = q.filter(Employee.entity_id == entity_id)

    if location_id:
        q = q.filter(Employee.location_id == location_id)
    if emp_status:
        q = q.filter(Employee.status == emp_status)
    if search:
        q = q.filter(
            Employee.name.ilike(f"%{search}%") | Employee.emp_code.ilike(f"%{search}%")
        )
    if department:
        q = q.join(Employee.department).filter(Department.name.ilike(f"%{department}%"))
    return q


# ---------------------------------------------------------------------------
# Form Options (dropdowns for add/edit employee forms)
# ---------------------------------------------------------------------------

@router.get("/form-options")
def get_form_options(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    entities = db.query(Entity).order_by(Entity.id).all()
    locations = db.query(Location).order_by(Location.city).all()
    departments = db.query(Department).order_by(Department.name).all()
    grades = db.query(Grade).order_by(Grade.code).all()
    shifts = db.query(Shift).order_by(Shift.name).all()
    return {
        "entities": [{"id": e.id, "name": e.name, "prefix": e.prefix} for e in entities],
        "locations": [{"id": l.id, "name": l.name, "city": l.city, "state": l.state, "entity_id": l.entity_id, "pt_state_code": l.pt_state_code} for l in locations],
        "departments": [{"id": d.id, "name": d.name, "entity_id": d.entity_id} for d in departments],
        "grades": [{"id": g.id, "code": g.code, "name": g.name, "entity_id": g.entity_id} for g in grades],
        "shifts": [{"id": s.id, "name": s.name, "in_time": str(s.in_time), "out_time": str(s.out_time), "entity_id": s.entity_id} for s in shifts],
    }


# ---------------------------------------------------------------------------
# Master Data
# ---------------------------------------------------------------------------

@router.get("/master-data")
def master_data(
    entity_id: Optional[str] = None,
    location_id: Optional[str] = None,
    department: Optional[str] = None,
    emp_status: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    q = _build_emp_query(db, current_user, entity_id, location_id, department, emp_status, search)
    total = q.count()
    employees = q.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [_build_master_row(emp, db) for emp in employees],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/master-data/export")
def master_data_export(
    entity_id: Optional[str] = None,
    location_id: Optional[str] = None,
    department: Optional[str] = None,
    emp_status: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = None,
    req: Request = None,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    q = _build_emp_query(db, current_user, entity_id, location_id, department, emp_status, search)
    employees = q.all()

    headers = [
        "emp_code", "legacy_code", "name", "father_name", "dob", "gender",
        "marital_status", "blood_group", "religion", "mobile", "email", "doj",
        "entity_id", "location_id", "location_city", "location_state",
        "department", "division", "designation", "grade", "reporting_mgr_code",
        "shift_id", "ctc_annual", "basic", "hra", "spl", "cca",
        "monthly_gross", "pf_applicable", "esic_applicable", "pt_applicable",
        "pan", "aadhaar", "uan", "esic_no", "bank_name", "ifsc", "bank_branch",
        "present_addr", "present_city", "present_state", "present_pin",
        "perm_addr", "perm_city", "perm_state", "perm_pin", "status", "exit_date",
    ]

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()

    for emp in employees:
        aadhaar_plain = _pgp_decrypt(db, emp.aadhaar_enc)
        gross = _compute_gross(emp.basic, emp.hra, emp.spl, emp.cca)
        writer.writerow({
            "emp_code": emp.emp_code,
            "legacy_code": emp.legacy_code or "",
            "name": emp.name,
            "father_name": emp.father_name or "",
            "dob": str(emp.dob) if emp.dob else "",
            "gender": emp.gender or "",
            "marital_status": emp.marital_status or "",
            "blood_group": emp.blood_group or "",
            "religion": emp.religion or "",
            "mobile": emp.mobile,
            "email": emp.email or "",
            "doj": str(emp.doj),
            "entity_id": emp.entity_id,
            "location_id": emp.location_id,
            "location_city": emp.location.city if emp.location else "",
            "location_state": emp.location.state if emp.location else "",
            "department": emp.department.name if emp.department else "",
            "division": emp.division or "",
            "designation": emp.designation or "",
            "grade": emp.grade.code if emp.grade else "",
            "reporting_mgr_code": emp.reporting_mgr_code or "",
            "shift_id": str(emp.shift_id) if emp.shift_id else "",
            "ctc_annual": str(emp.ctc_annual) if emp.ctc_annual else "",
            "basic": str(emp.basic) if emp.basic else "",
            "hra": str(emp.hra) if emp.hra else "",
            "spl": str(emp.spl) if emp.spl else "",
            "cca": str(emp.cca) if emp.cca else "",
            "monthly_gross": str(gross),
            "pf_applicable": str(emp.pf_applicable) if emp.pf_applicable is not None else "",
            "esic_applicable": str(emp.esic_applicable) if emp.esic_applicable is not None else "",
            "pt_applicable": str(emp.pt_applicable) if emp.pt_applicable is not None else "",
            "pan": emp.pan or "",
            "aadhaar": _mask_aadhaar(aadhaar_plain) or "",
            "uan": emp.uan or "",
            "esic_no": emp.esic_no or "",
            "bank_name": emp.bank_name or "",
            "ifsc": emp.ifsc or "",
            "bank_branch": emp.bank_branch or "",
            "present_addr": emp.present_addr or "",
            "present_city": emp.present_city or "",
            "present_state": emp.present_state or "",
            "present_pin": emp.present_pin or "",
            "perm_addr": emp.perm_addr or "",
            "perm_city": emp.perm_city or "",
            "perm_state": emp.perm_state or "",
            "perm_pin": emp.perm_pin or "",
            "status": emp.status or "",
            "exit_date": str(emp.exit_date) if emp.exit_date else "",
        })

    ip = req.client.host if req and req.client else None
    _audit(
        db,
        user_code=current_user.emp_code,
        action="EXPORT",
        record_id="ALL",
        table_name="employees",
        new_values={"detail": f"Exported {len(employees)} records"},
        ip=ip,
    )
    db.commit()

    csv_bytes = output.getvalue().encode("utf-8-sig")
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=master_data_export.csv"},
    )


# ---------------------------------------------------------------------------
# Column-wise Bulk Update
# ---------------------------------------------------------------------------

@router.post("/column-update/template")
def column_update_template(
    body: ColumnTemplateBody,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    bad_locked = [c for c in body.columns if c in _LOCKED_SET]
    if bad_locked:
        raise HTTPException(status_code=400, detail=f"Columns not updatable: {bad_locked}")
    bad_unknown = [c for c in body.columns if c not in _ALLOWED_SET]
    if bad_unknown:
        raise HTTPException(status_code=400, detail=f"Unknown or disallowed columns: {bad_unknown}")

    _assert_entity_access(current_user, body.entity_id)

    employees = (
        db.query(Employee)
        .filter(Employee.entity_id == body.entity_id, Employee.status == "active")
        .order_by(Employee.emp_code)
        .all()
    )

    fieldnames = ["emp_code"] + body.columns
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()

    for emp in employees:
        row = {"emp_code": emp.emp_code}
        for col in body.columns:
            val = getattr(emp, col, None)
            row[col] = str(val) if val is not None else ""
        writer.writerow(row)

    csv_bytes = output.getvalue().encode("utf-8-sig")
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=column_update_template.csv"},
    )


@router.post("/column-update/validate")
async def column_update_validate(
    file: UploadFile = File(...),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        text_data = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text_data = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text_data))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no headers")
    if "emp_code" not in reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must have emp_code column")

    columns = [f for f in reader.fieldnames if f != "emp_code"]
    if not columns:
        raise HTTPException(status_code=400, detail="CSV must have at least one data column besides emp_code")

    bad_locked = [c for c in columns if c in _LOCKED_SET]
    if bad_locked:
        raise HTTPException(status_code=400, detail=f"Columns not updatable: {bad_locked}")
    bad_unknown = [c for c in columns if c not in _ALLOWED_SET]
    if bad_unknown:
        raise HTTPException(status_code=400, detail=f"Unknown or disallowed columns: {bad_unknown}")

    actor_entity = _actor_entity_id(current_user)
    change_set = []
    errors = []

    for row_num, row in enumerate(reader, start=2):
        emp_code = (row.get("emp_code") or "").strip()
        if not emp_code:
            errors.append({"row": row_num, "error": "Missing emp_code"})
            continue

        emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
        if not emp:
            errors.append({"row": row_num, "emp_code": emp_code, "error": "Employee not found"})
            continue

        if actor_entity is not None and emp.entity_id != actor_entity:
            errors.append({"row": row_num, "emp_code": emp_code, "error": "Access denied for this entity"})
            continue

        emp_changes = []
        for col in columns:
            cell = row.get(col, "")
            if cell is None or cell.strip() == "":
                continue  # blank → skip per spec

            new_val_str = cell.strip()
            old_val = getattr(emp, col, None)
            old_val_str = str(old_val) if old_val is not None else ""

            if col in _NUMERIC_COLS:
                try:
                    Decimal(new_val_str)
                except InvalidOperation:
                    errors.append({
                        "row": row_num, "emp_code": emp_code, "column": col,
                        "error": f"Expected numeric value, got '{new_val_str}'",
                    })
                    continue
            elif col in _INT_COLS:
                if not new_val_str.isdigit():
                    errors.append({
                        "row": row_num, "emp_code": emp_code, "column": col,
                        "error": f"Expected integer, got '{new_val_str}'",
                    })
                    continue

            if new_val_str != old_val_str:
                emp_changes.append({
                    "column": col,
                    "old_value": old_val_str,
                    "new_value": new_val_str,
                })

        if emp_changes:
            change_set.append({"emp_code": emp_code, "changes": emp_changes})

    return {
        "change_set": change_set,
        "total_employees": len(change_set),
        "total_changes": sum(len(e["changes"]) for e in change_set),
        "errors": errors,
    }


@router.post("/column-update/commit")
def column_update_commit(
    body: ColumnCommitBody,
    req: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    if not body.change_set:
        raise HTTPException(status_code=400, detail="No changes to apply")

    actor_entity = _actor_entity_id(current_user)
    ip = req.client.host if req.client else None
    now = datetime.now(timezone.utc)

    for emp_update in body.change_set:
        emp = db.query(Employee).filter(Employee.emp_code == emp_update.emp_code).first()
        if not emp:
            raise HTTPException(status_code=404, detail=f"Employee not found: {emp_update.emp_code}")
        if actor_entity is not None and emp.entity_id != actor_entity:
            raise HTTPException(status_code=403, detail=f"Access denied for employee: {emp_update.emp_code}")

        old_vals: dict = {}
        new_vals: dict = {}
        salary_changed = False

        for change in emp_update.changes:
            col = change.column
            if col not in _ALLOWED_SET:
                raise HTTPException(status_code=400, detail=f"Column '{col}' is not updatable")

            old_vals[col] = str(getattr(emp, col, None))

            if col in _NUMERIC_COLS:
                setattr(emp, col, Decimal(change.new_value))
            elif col in _INT_COLS:
                setattr(emp, col, int(change.new_value))
            else:
                setattr(emp, col, change.new_value)

            new_vals[col] = change.new_value
            if col in _SALARY_FIELDS:
                salary_changed = True

        if salary_changed:
            gross = _compute_gross(emp.basic, emp.hra, emp.spl, emp.cca)
            old_vals["esic_applicable"] = str(emp.esic_applicable)
            emp.esic_applicable = gross <= Decimal("21000")
            new_vals["esic_applicable"] = str(emp.esic_applicable)

        emp.updated_at = now

        _audit(
            db,
            user_code=current_user.emp_code,
            action="COLUMN_UPDATE",
            record_id=emp_update.emp_code,
            table_name="employees",
            old_values=old_vals,
            new_values=new_vals,
            ip=ip,
        )

    db.commit()
    return {"message": f"Updated {len(body.change_set)} employees successfully", "applied": len(body.change_set)}


# ---------------------------------------------------------------------------
# Password Reset
# ---------------------------------------------------------------------------

@router.post("/reset-password")
def reset_password(
    body: ResetPasswordBody,
    req: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    emp = db.query(Employee).filter(Employee.emp_code == body.emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    _assert_entity_access(current_user, emp.entity_id)

    user = db.query(User).filter(User.emp_code == body.emp_code).first()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found for this employee")

    temp_password = f"Udyogi@{random.randint(1000, 9999)}"
    user.password_hash = hash_password(temp_password)
    user.is_first_login = True
    user.updated_at = datetime.now(timezone.utc)

    ip = req.client.host if req.client else None
    _audit(
        db,
        user_code=current_user.emp_code,
        action="RESET_PASSWORD",
        record_id=body.emp_code,
        table_name="users",
        ip=ip,
    )
    db.commit()

    return {
        "temp_password": temp_password,
        "message": "Share this with the employee. They must change it on first login.",
    }


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------

@router.get("/audit-log")
def get_audit_log(
    user_code: Optional[str] = None,
    action: Optional[str] = None,
    table_name: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    q = db.query(AuditLog)

    if user_code:
        q = q.filter(AuditLog.user_code == user_code)
    if action:
        q = q.filter(AuditLog.action == action)
    if table_name:
        q = q.filter(AuditLog.table_name == table_name)
    if from_date:
        try:
            q = q.filter(AuditLog.ts >= date.fromisoformat(from_date))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid from_date, use YYYY-MM-DD")
    if to_date:
        try:
            q = q.filter(AuditLog.ts < date.fromisoformat(to_date) + timedelta(days=1))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid to_date, use YYYY-MM-DD")

    total = q.count()
    logs = q.order_by(AuditLog.ts.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return {
        "items": [
            {
                "id": log.id,
                "user_code": log.user_code,
                "action": log.action,
                "table_name": log.table_name,
                "record_id": log.record_id,
                "old_values": log.old_values,
                "new_values": log.new_values,
                "ip_address": log.ip_address,
                "ts": log.ts,
            }
            for log in logs
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


# ---------------------------------------------------------------------------
# Statutory Config
# ---------------------------------------------------------------------------

@router.get("/statutory")
def get_statutory(
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(StatutoryConfig)
        .order_by(StatutoryConfig.state_code, StatutoryConfig.gross_from)
        .all()
    )
    grouped: dict[str, list] = {}
    for row in rows:
        grouped.setdefault(row.state_code, []).append({
            "id": row.id,
            "state_code": row.state_code,
            "gender": row.gender,
            "gross_from": row.gross_from,
            "gross_to": row.gross_to,
            "monthly_amount": row.monthly_amount,
            "feb_override": row.feb_override,
            "annual_cap": row.annual_cap,
            "filing_freq": row.filing_freq,
            "due_day": row.due_day,
            "penalty_desc": row.penalty_desc,
            "effective_from": row.effective_from,
            "effective_to": row.effective_to,
        })
    return grouped


@router.put("/statutory/{config_id}")
def update_statutory(
    config_id: int,
    body: StatutoryUpdateBody,
    req: Request,
    current_user: User = Depends(require_role("super_admin")),
    db: Session = Depends(get_db),
):
    row = db.get(StatutoryConfig, config_id)
    if not row:
        raise HTTPException(status_code=404, detail="Statutory config row not found")

    old_vals = {
        "gross_from": str(row.gross_from),
        "gross_to": str(row.gross_to),
        "monthly_amount": str(row.monthly_amount),
        "feb_override": str(row.feb_override) if row.feb_override is not None else None,
        "annual_cap": str(row.annual_cap) if row.annual_cap is not None else None,
        "filing_freq": row.filing_freq,
        "due_day": row.due_day,
        "penalty_desc": row.penalty_desc,
        "effective_from": str(row.effective_from),
        "effective_to": str(row.effective_to) if row.effective_to is not None else None,
    }

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)

    ip = req.client.host if req.client else None
    _audit(
        db,
        user_code=current_user.emp_code,
        action="UPDATE",
        record_id=str(config_id),
        table_name="statutory_config",
        old_values=old_vals,
        new_values=body.model_dump(mode="json", exclude_none=True),
        ip=ip,
    )
    db.commit()
    db.refresh(row)

    return {
        "id": row.id,
        "state_code": row.state_code,
        "gender": row.gender,
        "gross_from": row.gross_from,
        "gross_to": row.gross_to,
        "monthly_amount": row.monthly_amount,
        "feb_override": row.feb_override,
        "annual_cap": row.annual_cap,
        "filing_freq": row.filing_freq,
        "due_day": row.due_day,
        "penalty_desc": row.penalty_desc,
        "effective_from": row.effective_from,
        "effective_to": row.effective_to,
    }


# ===========================================================================
# PUBLIC HOLIDAYS (Part G — Session 13.14)
# ===========================================================================


class HolidayCreateBody(BaseModel):
    name:          str
    date:          date
    location_id:   Optional[str] = None
    is_restricted: bool = False


# ---------------------------------------------------------------------------
# GET /holidays
# ---------------------------------------------------------------------------

@router.get("/holidays")
def get_holidays(
    year:        int            = Query(...),
    location_id: Optional[str] = Query(default=None),
    db:          Session        = Depends(get_db),
    current_user: User          = Depends(get_current_user),
):
    from sqlalchemy import extract, or_
    q = db.query(PublicHoliday).filter(
        extract("year", PublicHoliday.date) == year,
    )
    if location_id:
        q = q.filter(
            or_(
                PublicHoliday.location_id == location_id,
                PublicHoliday.location_id == None,  # noqa: E711
            )
        )
    rows = q.order_by(PublicHoliday.date.asc()).all()
    return [
        {
            "id":           r.id,
            "name":         r.name,
            "date":         r.date.isoformat(),
            "location_id":  r.location_id,
            "applies_to":   "All locations" if r.location_id is None else r.location_id,
            "is_restricted": r.is_restricted,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# POST /holidays
# ---------------------------------------------------------------------------

@router.post("/holidays", status_code=201)
def create_holiday(
    body: HolidayCreateBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
):
    existing = (
        db.query(PublicHoliday)
        .filter(
            PublicHoliday.date == body.date,
            PublicHoliday.location_id == body.location_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Holiday already exists for {body.date} / location={body.location_id}",
        )

    holiday = PublicHoliday(
        name          = body.name,
        date          = body.date,
        location_id   = body.location_id,
        is_restricted = body.is_restricted,
        created_by    = current_user.emp_code,
    )
    db.add(holiday)
    db.flush()

    db.add(AuditLog(
        user_code  = current_user.emp_code,
        action     = "CREATE",
        table_name = "public_holidays",
        record_id  = str(holiday.id),
        new_values = {
            "name":          body.name,
            "date":          body.date.isoformat(),
            "location_id":   body.location_id,
            "is_restricted": body.is_restricted,
        },
    ))
    db.commit()
    db.refresh(holiday)
    return {
        "id":           holiday.id,
        "name":         holiday.name,
        "date":         holiday.date.isoformat(),
        "location_id":  holiday.location_id,
        "applies_to":   "All locations" if holiday.location_id is None else holiday.location_id,
        "is_restricted": holiday.is_restricted,
    }


# ---------------------------------------------------------------------------
# DELETE /holidays/{id}
# ---------------------------------------------------------------------------

@router.delete("/holidays/{holiday_id}")
def delete_holiday(
    holiday_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("super_admin")),
):
    holiday = db.query(PublicHoliday).filter(PublicHoliday.id == holiday_id).first()
    if not holiday:
        raise HTTPException(status_code=404, detail="Holiday not found")

    db.add(AuditLog(
        user_code  = current_user.emp_code,
        action     = "DELETE",
        table_name = "public_holidays",
        record_id  = str(holiday_id),
        old_values = {
            "name":        holiday.name,
            "date":        holiday.date.isoformat(),
            "location_id": holiday.location_id,
        },
    ))
    db.delete(holiday)
    db.commit()
    return {"deleted": holiday_id}
