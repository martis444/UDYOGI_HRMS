import csv
import io
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.db import get_db
from app.core.dependencies import get_current_user, require_role
from app.core.security import hash_password
from app.models.employee import (
    AuditLog, Department, Employee, Grade, Location, PayrollMonth, SalaryStructure, User,
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
from app.services.increment_service import apply_increment, prepare_increment_row
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
        "sap_code": emp.sap_code,
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
        "medical": emp.medical,
        "other_earning": emp.other_earning,
        "other_allowance": emp.other_allowance,
        "profit_center_code": emp.profit_center_code,
        "profit_center_name": emp.profit_center_name,
        "cost_center_code": emp.cost_center_code,
        "cost_center_name": emp.cost_center_name,
        "monthly_gross": gross,
        "category": emp.category,
        "probation_days": emp.probation_days,
        "probation_end_date": emp.probation_end_date,
        "confirmation_date": emp.confirmation_date,
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
        "present_addr": emp.present_addr,
        "perm_addr": emp.perm_addr,
        "status": emp.status,
        "exit_date": emp.exit_date,
        "resignation_date": emp.resignation_date,
        "retirement_date": emp.retirement_date,
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
    designation: Optional[str] = None,
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
    if designation:
        q = q.filter(Employee.designation.ilike(f"%{designation}%"))
    if search:
        like = f"%{search}%"
        q = q.filter(
            Employee.name.ilike(like)
            | Employee.emp_code.ilike(like)
            | Employee.legacy_code.ilike(like)
            | Employee.sap_code.ilike(like)
        )
    if department:
        q = q.join(Employee.department).filter(Department.name.ilike(f"%{department}%"))

    total = q.count()
    employees = q.offset((page - 1) * per_page).limit(per_page).all()

    items = [
        EmployeeListItem(
            emp_code=e.emp_code,
            sap_code=e.sap_code,
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


@router.get("/graph")
def employee_graph(
    entity_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lean, enriched employee feed for the experimental graph view.

    Read-only; entity-scoped like every other employee query. Returns ALL
    scoped employees in one shot (no pagination) with the few extra fields the
    graph's lenses need — current gross, statutory flags, key dates, and
    data-quality booleans (never the encrypted values themselves).
    """
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

    def _iso(d):
        return d.isoformat() if d else None

    items = []
    for e in q.all():
        gross = sum((getattr(e, f, 0) or 0) for f in _SALARY_FIELDS)
        items.append({
            "emp_code": e.emp_code,
            "sap_code": e.sap_code,
            "name": e.name,
            "entity_id": e.entity_id,
            "location_city": e.location.city if e.location else None,
            "department": e.department.name if e.department else None,
            "designation": e.designation,
            "grade": e.grade.code if e.grade else None,
            "status": e.status,
            "category": e.category,
            "gross": float(gross),
            "esic_applicable": e.esic_applicable,
            "reporting_mgr_code": e.reporting_mgr_code,
            "dob": _iso(e.dob),
            "doj": _iso(e.doj),
            "confirmation_date": _iso(e.confirmation_date),
            "retirement_date": _iso(e.retirement_date),
            "is_on_probation": e.is_on_probation,
            # data-quality flags (presence only — never the encrypted value)
            "has_pan": bool(e.pan),
            "has_bank": e.bank_acc_enc is not None,
            "has_sap": bool(e.sap_code),
            "has_uan": bool(e.uan),
            "has_confirmation": e.confirmation_date is not None,
        })

    return {"items": items, "total": len(items)}


@router.get("/export")
def export_employees(
    entity_id: Optional[str] = None,
    location_id: Optional[str] = None,
    department: Optional[str] = None,
    designation: Optional[str] = None,
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
    if designation:
        q = q.filter(Employee.designation.ilike(f"%{designation}%"))
    if search:
        like = f"%{search}%"
        q = q.filter(
            Employee.name.ilike(like)
            | Employee.emp_code.ilike(like)
            | Employee.legacy_code.ilike(like)
            | Employee.sap_code.ilike(like)
        )
    if department:
        q = q.join(Employee.department).filter(Department.name.ilike(f"%{department}%"))

    employees = q.all()

    # SAP code is the identity column (system emp_code is not exported). For an
    # employee with no SAP code yet, sap_code falls back to emp_code so the row stays
    # matchable on re-upload; the importer resolves either without polluting sap_code.
    headers = [
        "legacy_code", "sap_code", "name", "father_name", "dob", "gender",
        "marital_status", "blood_group", "religion", "mobile", "email", "doj",
        "entity_id", "location_id", "department", "division", "designation",
        "grade", "reporting_mgr_code", "shift_id", "ctc_annual", "basic",
        "hra", "spl", "cca", "leave_travel", "medical", "other_earning",
        "profit_center_code", "profit_center_name",
        "cost_center_code", "cost_center_name", "category",
        "pf_applicable", "esic_applicable",
        "pt_applicable", "pan", "aadhaar", "uan", "esic_no", "bank_name",
        "bank_acc", "ifsc", "present_addr", "perm_addr",
        "confirmation_date", "status", "resignation_date", "retirement_date",
    ]

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()

    for emp in employees:
        aadhaar_plain = _pgp_decrypt(db, emp.aadhaar_enc)
        bank_acc_plain = _pgp_decrypt(db, emp.bank_acc_enc)
        writer.writerow({
            "legacy_code": emp.legacy_code or "",
            "sap_code": emp.sap_code or emp.emp_code,
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
            "leave_travel": str(emp.leave_travel) if emp.leave_travel else "",
            "medical": str(emp.medical) if emp.medical else "",
            "other_earning": str(emp.other_earning) if emp.other_earning else "",
            "profit_center_code": emp.profit_center_code or "",
            "profit_center_name": emp.profit_center_name or "",
            "cost_center_code": emp.cost_center_code or "",
            "cost_center_name": emp.cost_center_name or "",
            "category": emp.category or "",
            "bank_name": emp.bank_name or "",
            "bank_acc": _mask_bank_acc(bank_acc_plain) or "",  # masked — never expose raw account no
            "ifsc": emp.ifsc or "",
            "present_addr": emp.present_addr or "",
            "perm_addr": emp.perm_addr or "",
            "confirmation_date": str(emp.confirmation_date) if emp.confirmation_date else "",
            "status": emp.status or "",
            "resignation_date": str(emp.resignation_date) if emp.resignation_date else "",
            "retirement_date": str(emp.retirement_date) if emp.retirement_date else "",
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

    # Compute statutory gross (leave_travel included; other_allowance excluded) and esic_applicable.
    # ESIC applies only under the ₹21k ceiling AND unless HR opted the employee out (default on).
    gross = _compute_gross(body.basic, body.hra, body.spl, body.cca, body.leave_travel)
    esic_applicable = gross <= Decimal("21000") and (
        body.esic_applicable if body.esic_applicable is not None else True
    )

    now = datetime.now(timezone.utc)
    ip = req.client.host if req.client else None

    emp = Employee(
        emp_code=emp_code,
        legacy_code=body.legacy_code,
        sap_code=body.sap_code,
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
        medical=body.medical or Decimal("0"),
        other_earning=body.other_earning or Decimal("0"),
        other_allowance=body.other_allowance or Decimal("0"),
        profit_center_code=body.profit_center_code,
        profit_center_name=body.profit_center_name,
        cost_center_code=body.cost_center_code,
        cost_center_name=body.cost_center_name,
        category=body.category or 'staff',
        probation_days=body.probation_days or 90,
        probation_end_date=body.probation_end_date,
        confirmation_date=body.confirmation_date,
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
        present_addr=body.present_addr,
        perm_addr=body.perm_addr,
        status=body.status or "active",
        exit_date=body.exit_date,
        resignation_date=body.resignation_date,
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

    # Rule 4 on salary change: enforce the ESIC ceiling, but only ever turn it OFF
    # (gross over ₹21k). Any manual opt-out/opt-in (already applied above from the
    # request body, or set earlier) is preserved while still under the ceiling — so
    # HR's "this employee doesn't take ESIC" choice isn't silently flipped back on.
    if any(f in orm_data for f in _SALARY_FIELDS):
        gross = _compute_gross(emp.basic, emp.hra, emp.spl, emp.cca, emp.leave_travel)
        if gross > Decimal("21000") and emp.esic_applicable:
            old_values["esic_applicable"] = str(emp.esic_applicable)
            emp.esic_applicable = False

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


# Tables holding the employee's OWN rows — deleted on a hard delete. Order matters:
# loan_emi_schedule before loans (it FKs loans.id). Each is guarded by to_regclass so
# a table absent on a given DB is skipped, not an error.
_HARD_DELETE_CHILDREN = [
    ("loan_emi_schedule", "emp_code"),
    ("loans",             "emp_code"),
    ("payroll_months",    "emp_code"),
    ("salary_structures", "emp_code"),
    ("attendance_daily",  "emp_code"),
    ("attendance_raw",    "emp_code"),
    ("biometric_mapping", "emp_code"),
    ("leave_balances",    "emp_code"),
    ("leave_accrual_log", "emp_code"),
    ("leave_requests",    "emp_code"),
    ("documents",         "emp_code"),
    ("helpdesk_tickets",  "emp_code"),
    ("assets",            "assigned_to"),
    ("users",             "emp_code"),
]
# OTHER rows that merely POINT AT this employee — null the reference, never delete them.
_HARD_DELETE_NULL_REFS = [
    ("leave_requests",  "approved_by"),
    ("documents",       "uploaded_by"),
    ("helpdesk_tickets", "assigned_to"),
    ("employees",       "reporting_mgr_code"),
]


def _table_exists(db: Session, table: str) -> bool:
    return db.execute(text("SELECT to_regclass(:t)"), {"t": f"public.{table}"}).scalar() is not None


@router.delete("/{emp_code}", status_code=status.HTTP_200_OK)
def delete_employee(
    emp_code: str,
    req: Request,
    hard: bool = Query(False, description="Permanently delete the employee and ALL their records (super_admin only)."),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    if emp_code in PROTECTED_FIGURE_CODES:
        raise HTTPException(status_code=400, detail="Protected company figure cannot be deleted.")

    emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    _assert_entity_access(current_user, emp.entity_id)

    ip = req.client.host if req.client else None

    # ── HARD delete: permanently remove the employee + all dependent records ──────
    if hard:
        if current_user.role != "super_admin":
            raise HTTPException(status_code=403, detail="Only a super admin can permanently delete an employee.")
        # Safeguard: never wipe FINALIZED payroll. Locked months must be unlocked first.
        locked = (
            db.query(func.count(PayrollMonth.id))
            .filter(PayrollMonth.emp_code == emp_code, PayrollMonth.status == "locked")
            .scalar()
        )
        if locked:
            raise HTTPException(
                status_code=400,
                detail=(f"{emp_code} has {locked} locked payroll month(s). Unlock them first, or use "
                        "Deactivate — hard delete is blocked to protect finalized payroll."),
            )

        snapshot = {"name": emp.name, "entity_id": emp.entity_id, "status": emp.status}
        removed: dict[str, int] = {}
        # Null back-references first (other rows pointing at this employee).
        for table, col in _HARD_DELETE_NULL_REFS:
            if _table_exists(db, table):
                res = db.execute(text(f"UPDATE {table} SET {col} = NULL WHERE {col} = :c"), {"c": emp_code})
                if res.rowcount:
                    removed[f"{table}.{col}→null"] = res.rowcount
        # Delete the employee's own child rows.
        for table, col in _HARD_DELETE_CHILDREN:
            if _table_exists(db, table):
                res = db.execute(text(f"DELETE FROM {table} WHERE {col} = :c"), {"c": emp_code})
                if res.rowcount:
                    removed[table] = res.rowcount
        db.execute(text("DELETE FROM employees WHERE emp_code = :c"), {"c": emp_code})

        _audit(db, user_code=current_user.emp_code, action="HARD_DELETE", record_id=emp_code,
               old_values=snapshot, new_values={"removed": removed}, ip=ip)
        db.commit()
        return {"message": f"Employee {emp_code} permanently deleted", "removed": removed}

    # ── SOFT delete (default): mark inactive, preserve all history ────────────────
    if emp.status == "inactive":
        raise HTTPException(status_code=400, detail="Employee is already inactive")

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
    # commit_import returns {imported, updated, ...}; the UI reads {created, updated, message}.
    created, updated = result["imported"], result.get("updated", 0)
    parts = []
    if created:
        parts.append(f"{created} created")
    if updated:
        parts.append(f"{updated} updated")
    return {
        "created": created,
        "updated": updated,
        "message": (", ".join(parts) + " employee(s)." if parts else "No changes."),
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
    other_earning: Optional[Decimal] = None
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
        "other_earning":   s.other_earning,
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
        for c in ("basic", "hra", "spl", "cca", "leave_travel", "other_earning")
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


# ---------------------------------------------------------------------------
# Bulk increment
# ---------------------------------------------------------------------------

class BulkIncrementCommitBody(BaseModel):
    rows: list[dict]


@router.get("/bulk-increment/template")
def bulk_increment_template(
    entity_id: str = Query(...),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    """Pre-filled bulk-increment template — same salary columns as the salary sheet, one
    row per active employee with their CURRENT salary, plus blank Effective From / Reason.
    Edit the new values for whoever's getting a raise, fill their Effective From (1st of a
    month) + Reason, and re-upload. A blank Effective From means that row is NOT incremented."""
    _assert_entity_access(current_user, entity_id)
    employees = (
        db.query(Employee)
        .filter(Employee.entity_id == entity_id, Employee.status == "active")
        .order_by(Employee.name)
        .all()
    )

    def _n(v) -> str:
        d = float(v or 0)
        return str(int(d)) if d == int(d) else f"{d:.2f}"

    out = io.StringIO()
    out.write("SAP Code,Employee Name,Basic,HRA,Medical,Special,CCA,LTA,"
              "Other Allowance,Effective From,Reason\n")
    for e in employees:
        ident = (e.sap_code or e.emp_code or "").replace(",", " ")
        name = (e.name or "").replace(",", " ")
        out.write(",".join([
            ident, name, _n(e.basic), _n(e.hra), _n(e.medical), _n(e.spl),
            _n(e.cca), _n(e.leave_travel), _n(e.other_earning), "", "",
        ]) + "\n")
    out.write("\n,SAP Code identifies the employee — do NOT edit it. Change the new salary "
              "values for employees getting an increment;\n")
    out.write(",fill their Effective From (must be the 1st of a month, e.g. 01-05-2026) and "
              "Reason (increment or correction). Leave Effective From blank to skip a row.\n")

    return StreamingResponse(
        io.BytesIO(out.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=bulk_increment_{entity_id}.csv"},
    )


@router.post("/bulk-increment/validate")
async def bulk_increment_validate(
    file: UploadFile = File(...),
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    """Dry-run: parse + validate a bulk-increment CSV/XLSX (salary-sheet-style). No DB writes.

    Columns: SAP Code (or Emp Code), Employee Name, Basic, HRA, Medical, Special, CCA,
    LTA, Other Allowance (the NEW absolute values), Effective From (1st of a month) + Reason.
    A blank Effective From skips that row (not incremented)."""
    rows = await parse_upload_file(file)
    actor_entity = _actor_entity_id(current_user)
    prepared = [prepare_increment_row(r, db, actor_entity) for r in rows]
    valid = [p for p in prepared if "error" not in p and not p.get("skip")]
    errors = [
        {"emp_code": p.get("emp_code") or "—", "error": p["error"]}
        for p in prepared if "error" in p
    ]
    skipped = sum(1 for p in prepared if p.get("skip"))
    return {
        "valid": valid,
        "errors": errors,
        "total_valid": len(valid),
        "total_error": len(errors),
        "skipped": skipped,
    }


@router.post("/bulk-increment/commit")
def bulk_increment_commit(
    body: BulkIncrementCommitBody,
    req: Request,
    current_user: User = Depends(require_role("super_admin", "entity_admin")),
    db: Session = Depends(get_db),
):
    """Apply previously-validated bulk increments in ONE transaction (all or nothing)."""
    if not body.rows:
        raise HTTPException(status_code=400, detail="No increments to apply")

    actor_entity = _actor_entity_id(current_user)
    applied: list[str] = []
    try:
        for r in body.rows:
            emp_code = (r.get("emp_code") or "").strip()
            if not emp_code:
                raise ValueError("a row is missing emp_code")
            # entity-scope re-check (defence in depth — never trust the client)
            if actor_entity is not None:
                emp = db.query(Employee).filter(Employee.emp_code == emp_code).first()
                if emp is None or emp.entity_id != actor_entity:
                    raise ValueError(f"{emp_code}: access denied")
            new_values = {k: Decimal(str(v)) for k, v in (r.get("new_values") or {}).items()}
            apply_increment(
                db,
                emp_code=emp_code,
                effective_from=date.fromisoformat(r["effective_from"]),
                new_values=new_values,
                reason=(r.get("reason") or "increment"),
                actor_emp_code=current_user.emp_code,
            )
            applied.append(emp_code)
    except (ValueError, KeyError) as exc:
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"Increment failed — nothing was applied: {exc}"
        )

    db.commit()
    return {"applied": len(applied), "emp_codes": applied}


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

