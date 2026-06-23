import csv
import io
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

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
    AuditLog, Department, Employee, Grade, Location, SalaryStructure, User,
)
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeListItem,
    EmployeeListResponse,
    EmployeeResponse,
    EmployeeUpdate,
)
from app.services.import_service import (
    commit_import,
    generate_emp_code,
    parse_upload_file,
    validate_import_rows,
)
from app.services.increment_service import apply_increment
from app.services import salary_resolver
from app.services.leave_engine import ensure_leave_rows

router = APIRouter()

_SALARY_FIELDS = ("basic", "hra", "spl", "cca", "leave_travel")

# Prominent company figures (UP000001..UP000008): name is locked and rows cannot be
# deleted via the API. All other fields stay editable. (DB trigger is belt-and-braces.)
PROTECTED_FIGURE_CODES = {f"UP{n:06d}" for n in range(1, 9)}


class BulkCommitBody(BaseModel):
    rows: list[dict[str, Any]]
    filename: str = ""


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


def _pgp_encrypt(db: Session, plaintext: str) -> bytes:
    return db.execute(
        select(func.pgp_sym_encrypt(plaintext, settings.ENCRYPTION_KEY))
    ).scalar()


def _pgp_decrypt(db: Session, ciphertext: bytes) -> Optional[str]:
    if ciphertext is None:
        return None
    return db.execute(
        select(func.pgp_sym_decrypt(ciphertext, settings.ENCRYPTION_KEY))
    ).scalar()


def _compute_gross(*values) -> Decimal:
    return sum(Decimal(str(v)) for v in values if v is not None)


def _mask_aadhaar(plain: Optional[str]) -> Optional[str]:
    if not plain:
        return None
    digits = re.sub(r"\D", "", plain)
    return f"XXXX XXXX {digits[-4:]}" if len(digits) >= 4 else "XXXX XXXX XXXX"


def _mask_bank_acc(plain: Optional[str]) -> Optional[str]:
    if not plain:
        return None
    return f"XXXX {plain[-4:]}" if len(plain) >= 4 else "XXXX"


def _mask_audit_body(data: dict) -> dict:
    masked = {k: v for k, v in data.items()}
    if masked.get("aadhaar"):
        masked["aadhaar"] = "XXXX XXXX XXXX"
    if masked.get("bank_acc"):
        masked["bank_acc"] = "XXXX XXXX"
    if masked.get("pan"):
        pan = masked["pan"]
        masked["pan"] = pan[:3] + "XXXXXXX" if len(pan) >= 3 else "XXXXXXXXXX"
    return masked


def _actor_entity_id(current_user: User) -> Optional[str]:
    """Returns None for super_admin (unrestricted access)."""
    if current_user.role == "super_admin":
        return None
    return current_user.employee.entity_id


def _assert_entity_access(current_user: User, target_entity_id: str) -> None:
    actor_entity = _actor_entity_id(current_user)
    if actor_entity is not None and actor_entity != target_entity_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for this entity")


def _build_response(emp: Employee, db: Session) -> dict:
    aadhaar_plain = _pgp_decrypt(db, emp.aadhaar_enc)
    bank_acc_plain = _pgp_decrypt(db, emp.bank_acc_enc)
    gross = _compute_gross(emp.basic, emp.hra, emp.spl, emp.cca, emp.leave_travel)

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
        "department_id": emp.department_id,
        "division": emp.division,
        "designation": emp.designation,
        "grade_id": emp.grade_id,
        "reporting_mgr_code": emp.reporting_mgr_code,
        "shift_id": emp.shift_id,
        "ctc_annual": emp.ctc_annual,
        "basic": emp.basic,
        "hra": emp.hra,
        "spl": emp.spl,
        "cca": emp.cca,
        "leave_travel": emp.leave_travel,
        "other_allowance": emp.other_allowance,
        "monthly_gross": gross,
        "category": emp.category,
        "probation_days": emp.probation_days,
        "probation_end_date": emp.probation_end_date,
        "is_on_probation": emp.is_on_probation,
        "pf_applicable": emp.pf_applicable,
        "esic_applicable": emp.esic_applicable,
        "pt_applicable": emp.pt_applicable,
        "pan": emp.pan,
        "aadhaar": _mask_aadhaar(aadhaar_plain),
        "uan": emp.uan,
        "esic_no": emp.esic_no,
        "bank_name": emp.bank_name,
        "bank_acc": _mask_bank_acc(bank_acc_plain),
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/next-code")
def next_emp_code(
    entity_id: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the next available emp_code for the given entity (preview only — does not reserve it)."""
    _assert_entity_access(current_user, entity_id)
    # Read without FOR UPDATE — preview only; actual lock happens on POST
    from app.models.employee import Entity
    entity = db.get(Entity, entity_id)
    if not entity:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")
    prefix = entity.prefix
    last = (
        db.query(Employee)
        .filter(Employee.emp_code.like(f"{prefix}%"))
        .order_by(Employee.emp_code.desc())
        .first()
    )
    serial = int(last.emp_code[len(prefix):]) + 1 if last else 1
    return {"next_emp_code": f"{prefix}{serial:06d}"}


@router.get("", response_model=EmployeeListResponse)
def list_employees(
    entity_id: Optional[str] = None,
    location_id: Optional[str] = None,
    department: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = (
        db.query(Employee)
        .options(
            joinedload(Employee.location),
            joinedload(Employee.department),
            joinedload(Employee.grade),
        )
    )

    # Enforce entity scope server-side
    actor_entity = _actor_entity_id(current_user)
    if actor_entity is not None:
        q = q.filter(Employee.entity_id == actor_entity)
    elif entity_id:
        q = q.filter(Employee.entity_id == entity_id)

    if location_id:
        q = q.filter(Employee.location_id == location_id)
    if status:
        q = q.filter(Employee.status == status)
    if search:
        q = q.filter(
            Employee.name.ilike(f"%{search}%") | Employee.emp_code.ilike(f"%{search}%")
        )
    if department:
        q = q.join(Employee.department).filter(Department.name.ilike(f"%{department}%"))

    total = q.count()
    employees = q.offset((page - 1) * per_page).limit(per_page).all()

    items = [
        EmployeeListItem(
            emp_code=e.emp_code,
            name=e.name,
            entity_id=e.entity_id,
            location_city=e.location.city if e.location else None,
            department=e.department.name if e.department else None,
            designation=e.designation,
            grade=e.grade.code if e.grade else None,
            status=e.status,
        )
        for e in employees
    ]

    return EmployeeListResponse(items=items, total=total, page=page, per_page=per_page)


@router.get("/export")
def export_employees(
    entity_id: Optional[str] = None,
    location_id: Optional[str] = None,
    department: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    req: Request = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export all matching employees as a CSV download. Aadhaar is masked; bank_acc excluded."""
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
    if status:
        q = q.filter(Employee.status == status)
    if search:
        q = q.filter(
            Employee.name.ilike(f"%{search}%") | Employee.emp_code.ilike(f"%{search}%")
        )
    if department:
        q = q.join(Employee.department).filter(Department.name.ilike(f"%{department}%"))

    employees = q.all()

    headers = [
        "emp_code", "legacy_code", "name", "father_name", "dob", "gender",
        "marital_status", "blood_group", "religion", "mobile", "email", "doj",
        "entity_id", "location_id", "department", "division", "designation",
        "grade", "reporting_mgr_code", "shift_id", "ctc_annual", "basic",
        "hra", "spl", "cca", "pf_applicable", "esic_applicable",
        "pt_applicable", "pan", "aadhaar", "uan", "esic_no", "bank_name",
        "ifsc", "bank_branch", "present_addr", "present_city", "present_state",
        "present_pin", "perm_addr", "perm_city", "perm_state", "perm_pin", "status",
    ]

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()

    for emp in employees:
        aadhaar_plain = _pgp_decrypt(db, emp.aadhaar_enc)
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
            "pf_applicable": str(emp.pf_applicable) if emp.pf_applicable is not None else "",
            "esic_applicable": str(emp.esic_applicable) if emp.esic_applicable is not None else "",
            "pt_applicable": str(emp.pt_applicable) if emp.pt_applicable is not None else "",
            "pan": emp.pan or "",
            "aadhaar": _mask_aadhaar(aadhaar_plain),  # masked — never expose raw aadhaar
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
        })

    ip = req.client.host if req and req.client else None
    _audit(
        db,
        user_code=current_user.emp_code,
        action="EXPORT",
        record_id="ALL",
        table_name="employees",
        new_values={"count": len(employees)},
        ip=ip,
    )
    db.commit()

    csv_bytes = output.getvalue().encode("utf-8-sig")  # BOM for Excel compatibility
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=employees_export.csv"},
    )


@router.get("/{emp_code}", response_model=EmployeeResponse)
def get_employee(
    emp_code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    _assert_entity_access(current_user, emp.entity_id)
    return EmployeeResponse(**_build_response(emp, db))


@router.post("", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
def create_employee(
    body: EmployeeCreate,
    req: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    _assert_entity_access(current_user, body.entity_id)

    emp_code = body.emp_code or generate_emp_code(body.entity_id, db)

    # Check for duplicate
    if db.get(Employee, emp_code):
        raise HTTPException(status_code=409, detail=f"emp_code '{emp_code}' already exists")

    # Compute statutory gross (leave_travel included; other_allowance excluded) and esic_applicable
    gross = _compute_gross(body.basic, body.hra, body.spl, body.cca, body.leave_travel)
    esic_applicable = gross <= Decimal("21000")

    now = datetime.now(timezone.utc)
    ip = req.client.host if req.client else None

    emp = Employee(
        emp_code=emp_code,
        legacy_code=body.legacy_code,
        name=body.name,
        father_name=body.father_name,
        dob=body.dob,
        gender=body.gender,
        marital_status=body.marital_status,
        blood_group=body.blood_group,
        religion=body.religion,
        mobile=body.mobile,
        email=body.email,
        doj=body.doj,
        entity_id=body.entity_id,
        location_id=body.location_id,
        department_id=body.department_id,
        division=body.division,
        designation=body.designation,
        grade_id=body.grade_id,
        reporting_mgr_code=body.reporting_mgr_code,
        shift_id=body.shift_id,
        ctc_annual=body.ctc_annual,
        basic=body.basic,
        hra=body.hra,
        spl=body.spl,
        cca=body.cca,
        leave_travel=body.leave_travel or Decimal("0"),
        other_allowance=body.other_allowance or Decimal("0"),
        category=body.category or 'staff',
        probation_days=body.probation_days or 90,
        probation_end_date=body.probation_end_date,
        is_on_probation=True,
        pf_applicable=body.pf_applicable,
        esic_applicable=esic_applicable,
        pt_applicable=body.pt_applicable,
        pan=body.pan,
        aadhaar_enc=_pgp_encrypt(db, body.aadhaar) if body.aadhaar else None,
        uan=body.uan,
        esic_no=body.esic_no,
        bank_name=body.bank_name,
        bank_acc_enc=_pgp_encrypt(db, body.bank_acc) if body.bank_acc else None,
        ifsc=body.ifsc,
        bank_branch=body.bank_branch,
        present_addr=body.present_addr,
        present_city=body.present_city,
        present_state=body.present_state,
        present_pin=body.present_pin,
        perm_addr=body.perm_addr,
        perm_city=body.perm_city,
        perm_state=body.perm_state,
        perm_pin=body.perm_pin,
        status=body.status or "active",
        exit_date=body.exit_date,
        created_at=now,
        updated_at=now,
        created_by=current_user.emp_code,
    )
    db.add(emp)

    # Create user account: default password = "Udyogi@" + last 4 of mobile,
    # falling back to the emp_code when no mobile was provided.
    default_pw = f"Udyogi@{(body.mobile or emp_code)[-4:]}"
    db.add(User(
        emp_code=emp_code,
        password_hash=hash_password(default_pw),
        role="employee",
        is_first_login=True,
        is_active=True,
        created_at=now,
        updated_at=now,
    ))

    audit_body = _mask_audit_body(body.model_dump(mode="json", exclude={"emp_code"}))
    audit_body["emp_code"] = emp_code
    _audit(db, user_code=current_user.emp_code, action="CREATE", record_id=emp_code,
           new_values=audit_body, ip=ip)

    db.commit()
    # Ensure CL/SL/PL leave rows exist (entitlement 0 until the first anniversary).
    ensure_leave_rows(emp_code, db)
    db.commit()
    db.refresh(emp)
    return EmployeeResponse(**_build_response(emp, db))


@router.put("/{emp_code}", response_model=EmployeeResponse)
async def update_employee(
    emp_code: str,
    request: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    raw = await request.json()
    if "emp_code" in raw:
        raise HTTPException(status_code=400, detail="emp_code is immutable and cannot be updated")

    body = EmployeeUpdate.model_validate(raw)

    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    _assert_entity_access(current_user, emp.entity_id)

    # Protected company figures: name is locked (everything else stays editable).
    if emp_code in PROTECTED_FIGURE_CODES and "name" in raw and raw["name"] != emp.name:
        raise HTTPException(status_code=400, detail="Name of a protected company figure cannot be changed.")

    ip = request.client.host if request.client else None

    # Two views of the update: native types for ORM, JSON-safe strings for audit
    orm_data = body.model_dump(exclude_none=True)           # date/Decimal preserved
    audit_new: dict = body.model_dump(mode="json", exclude_none=True)  # all strings/floats
    old_values: dict = {}

    for field, new_val in orm_data.items():
        if field in ("aadhaar", "bank_acc"):
            continue
        old_val = getattr(emp, field, None)
        old_values[field] = str(old_val) if old_val is not None else None
        setattr(emp, field, new_val)

    # Encrypted fields — update separately
    if body.aadhaar is not None:
        emp.aadhaar_enc = _pgp_encrypt(db, body.aadhaar)
        old_values["aadhaar"] = "ENCRYPTED"
        audit_new["aadhaar"] = "UPDATED"

    if body.bank_acc is not None:
        emp.bank_acc_enc = _pgp_encrypt(db, body.bank_acc)
        old_values["bank_acc"] = "ENCRYPTED"
        audit_new["bank_acc"] = "UPDATED"

    # Recompute esic_applicable if any salary field changed
    if any(f in orm_data for f in _SALARY_FIELDS):
        gross = _compute_gross(emp.basic, emp.hra, emp.spl, emp.cca, emp.leave_travel)
        new_esic = gross <= Decimal("21000")
        old_values["esic_applicable"] = str(emp.esic_applicable)
        emp.esic_applicable = new_esic

    emp.updated_at = datetime.now(timezone.utc)

    _audit(db, user_code=current_user.emp_code, action="UPDATE", record_id=emp_code,
           old_values=old_values, new_values=audit_new, ip=ip)

    db.commit()
    # DOJ change shifts years-of-service → re-materialize derived entitlement.
    if "doj" in orm_data:
        ensure_leave_rows(emp_code, db)
        db.commit()
    db.refresh(emp)
    return EmployeeResponse(**_build_response(emp, db))


@router.delete("/{emp_code}", status_code=status.HTTP_200_OK)
def deactivate_employee(
    emp_code: str,
    req: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    if emp_code in PROTECTED_FIGURE_CODES:
        raise HTTPException(status_code=400, detail="Protected company figure cannot be deleted.")

    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    _assert_entity_access(current_user, emp.entity_id)

    if emp.status == "inactive":
        raise HTTPException(status_code=400, detail="Employee is already inactive")

    ip = req.client.host if req.client else None
    old_status = emp.status

    emp.status = "inactive"
    emp.exit_date = date.today()
    emp.updated_at = datetime.now(timezone.utc)

    _audit(db, user_code=current_user.emp_code, action="DELETE", record_id=emp_code,
           old_values={"status": old_status}, new_values={"status": "inactive", "exit_date": str(emp.exit_date)},
           ip=ip)

    db.commit()
    return {"message": f"Employee {emp_code} deactivated", "exit_date": str(emp.exit_date)}


# ---------------------------------------------------------------------------
# Bulk import
# ---------------------------------------------------------------------------

@router.post("/bulk-import/validate")
async def bulk_import_validate(
    file: UploadFile = File(...),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    """
    Dry-run: parse and validate the uploaded CSV/XLSX without writing to the DB.
    Returns the frontend contract: {valid, errors, total_valid, total_error}.
    """
    rows = await parse_upload_file(file)
    result = validate_import_rows(rows, db)
    # validate_import_rows yields {valid, invalid, valid_count, error_count} where
    # each invalid row is {row, data, errors:[{column, error}, ...]}. Reshape to the
    # flat per-error list the UI reads. emp_code is auto-generated (blank) on import,
    # so the report shows legacy_code — falling back to name — to identify the row.
    def _row_label(data: dict) -> str:
        # Use `or ""` not get-default: keys may be present with value None.
        return (
            (data.get("legacy_code") or "").strip()
            or (data.get("name") or "").strip()
            or "—"
        )

    errors = [
        {
            "row": item["row"],
            "legacy_code": _row_label(item["data"]),
            "column": err["column"],
            "error": err["error"],
        }
        for item in result["invalid"]
        for err in item["errors"]
    ]
    return {
        "valid": result["valid"],
        "errors": errors,
        "total_valid": result["valid_count"],
        "total_error": result["error_count"],
    }


@router.post("/bulk-import/commit", status_code=status.HTTP_201_CREATED)
def bulk_import_commit(
    body: BulkCommitBody,
    req: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    """
    Commit previously validated rows (send back the 'valid' list from /validate).
    Enforces entity-scope access. Wraps all inserts in a single transaction.
    """
    if not body.rows:
        raise HTTPException(status_code=400, detail="No rows to import")

    # Enforce entity scope: non-super_admin may only commit for their own entity
    actor_entity = _actor_entity_id(current_user)
    if actor_entity is not None:
        bad = {r.get("entity_id") for r in body.rows if r.get("entity_id") != actor_entity}
        if bad:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied for entities: {sorted(bad)}",
            )

    result = commit_import(
        valid_rows=body.rows,
        db=db,
        imported_by=current_user.emp_code,
        filename=body.filename,
    )
    # commit_import returns {imported, codes}; the UI reads {created, message}.
    return {
        "created": result["imported"],
        "message": f"{result['imported']} employee(s) created.",
    }


# ---------------------------------------------------------------------------
# Salary structure history + increments
# ---------------------------------------------------------------------------

class IncrementBody(BaseModel):
    effective_from: date            # must be the 1st of a month (pay-period start)
    basic: Optional[Decimal] = None
    hra: Optional[Decimal] = None
    spl: Optional[Decimal] = None
    cca: Optional[Decimal] = None
    leave_travel: Optional[Decimal] = None
    other_allowance: Optional[Decimal] = None
    reason: str = "increment"       # 'increment' | 'correction'


def _structure_dict(s: SalaryStructure) -> dict:
    """Serialise a SalaryStructure with computed gross + derived status."""
    gross = _compute_gross(s.basic, s.hra, s.spl, s.cca, s.leave_travel)
    return {
        "id":              s.id,
        "effective_from":  s.effective_from,
        "effective_to":    s.effective_to,
        "basic":           s.basic,
        "hra":             s.hra,
        "spl":             s.spl,
        "cca":             s.cca,
        "leave_travel":    s.leave_travel,
        "other_allowance": s.other_allowance,
        "gross":           gross,
        "reason":          s.reason,
        "created_by":      s.created_by,
        "created_at":      s.created_at,
        "status":          "active" if s.effective_to is None else "historical",
    }


@router.post("/{emp_code}/increment")
def apply_salary_increment(
    emp_code: str,
    body: IncrementBody,
    req: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    """Apply an effective-dated salary increment (effective_from must be the 1st)."""
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    _assert_entity_access(current_user, emp.entity_id)

    new_values = {
        c: getattr(body, c)
        for c in ("basic", "hra", "spl", "cca", "leave_travel", "other_allowance")
    }

    try:
        new_struct = apply_increment(
            db,
            emp_code=emp_code,
            effective_from=body.effective_from,
            new_values=new_values,
            reason=body.reason,
            actor_emp_code=current_user.emp_code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db.commit()
    db.refresh(new_struct)
    db.refresh(emp)

    result = _structure_dict(new_struct)
    result["gross"] = _compute_gross(
        new_struct.basic, new_struct.hra,
        new_struct.spl, new_struct.cca, new_struct.leave_travel,
    )
    return {"structure": result, "gross": result["gross"]}


@router.get("/{emp_code}/salary-history")
def get_salary_history(
    emp_code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All salary structures for an employee, newest first (active row first)."""
    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Access: employees may view only their own; admins are entity-scoped.
    if current_user.role == "employee":
        if current_user.emp_code != emp_code:
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        _assert_entity_access(current_user, emp.entity_id)

    rows = (
        db.query(SalaryStructure)
        .filter(SalaryStructure.emp_code == emp_code)
        .order_by(
            SalaryStructure.effective_to.is_(None).desc(),
            SalaryStructure.effective_from.desc(),
        )
        .all()
    )
    return {"emp_code": emp_code, "structures": [_structure_dict(s) for s in rows]}

