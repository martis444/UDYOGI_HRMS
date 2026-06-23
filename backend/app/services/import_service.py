# Bulk import service
# Handles Excel/CSV parsing for employee and attendance uploads
# Blank cells are skipped — never overwrite existing data with empty

import io
import math
import re
from collections import Counter
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

import pandas as pd
from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password

_CODE_RE = re.compile(r"^(UP|US|UA|UM)\d{6}$")
# One or more 10-digit mobile numbers, multiples separated by "/" (spaces ok).
_MOBILE_RE = re.compile(r"^\d{10}(\s*/\s*\d{10})*$")

# Map (lowercased, stripped) upload column headers → canonical model field names
_COL_MAP: dict[str, str] = {
    # emp_code
    "hrms code": "emp_code",
    "emp_id": "emp_code",
    "emp_code": "emp_code",
    "employee code": "emp_code",
    "employee id": "emp_code",
    # legacy_code
    "legacy code": "legacy_code",
    "legacy_code": "legacy_code",
    "old code": "legacy_code",
    # name
    "employee name": "name",
    "name": "name",
    "full name": "name",
    # father_name
    "father name": "father_name",
    "father's name": "father_name",
    "father_name": "father_name",
    # dob
    "date of birth": "dob",
    "dob": "dob",
    "birth date": "dob",
    # gender
    "gender": "gender",
    "sex": "gender",
    # marital_status
    "marital status": "marital_status",
    "marital_status": "marital_status",
    # blood_group
    "blood group": "blood_group",
    "blood_group": "blood_group",
    "blood type": "blood_group",
    # religion
    "religion": "religion",
    # mobile
    "mobile": "mobile",
    "mobile no": "mobile",
    "mobile_no": "mobile",
    "phone": "mobile",
    "contact no": "mobile",
    "mobile number": "mobile",
    # email
    "email": "email",
    "email id": "email",
    "email address": "email",
    # doj
    "date of joining": "doj",
    "doj": "doj",
    "joining date": "doj",
    "date joined": "doj",
    # entity_id
    "entity": "entity_id",
    "entity_id": "entity_id",
    "company": "entity_id",
    "company code": "entity_id",
    # location_id
    "location": "location_id",
    "location_id": "location_id",
    "location code": "location_id",
    # department_id
    "department": "department_id",
    "department_id": "department_id",
    "dept": "department_id",
    "dept id": "department_id",
    # division
    "division": "division",
    # designation
    "designation": "designation",
    "post": "designation",
    # grade_id
    "grade": "grade_id",
    "grade_id": "grade_id",
    "grade code": "grade_id",
    # reporting_mgr_code
    "reporting manager": "reporting_mgr_code",
    "reporting_mgr_code": "reporting_mgr_code",
    "manager code": "reporting_mgr_code",
    "supervisor": "reporting_mgr_code",
    # shift_id
    "shift": "shift_id",
    "shift_id": "shift_id",
    "shift code": "shift_id",
    # ctc_annual
    "ctc annual": "ctc_annual",
    "ctc_annual": "ctc_annual",
    "annual ctc": "ctc_annual",
    "ctc": "ctc_annual",
    # basic
    "basic": "basic",
    "basic salary": "basic",
    # hra
    "hra": "hra",
    "house rent allowance": "hra",
    # spl
    "spl": "spl",
    "special allowance": "spl",
    "special": "spl",
    # cca
    "cca": "cca",
    "city compensatory allowance": "cca",
    # leave_travel
    "leave travel": "leave_travel",
    "leave_travel": "leave_travel",
    "lta": "leave_travel",
    # other_allowance
    "other allowance": "other_allowance",
    "other_allowance": "other_allowance",
    # pf_applicable
    "pf applicable": "pf_applicable",
    "pf_applicable": "pf_applicable",
    # pt_applicable
    "pt applicable": "pt_applicable",
    "pt_applicable": "pt_applicable",
    # pan
    "pan": "pan",
    "pan no": "pan",
    "pan number": "pan",
    "pan card": "pan",
    # aadhaar
    "aadhaar": "aadhaar",
    "aadhaar no": "aadhaar",
    "aadhaar number": "aadhaar",
    "aadhar": "aadhaar",
    "aadhar no": "aadhaar",
    # uan
    "uan": "uan",
    "uan no": "uan",
    "universal account number": "uan",
    # esic_no
    "esic no": "esic_no",
    "esic_no": "esic_no",
    "esic number": "esic_no",
    "esic": "esic_no",
    # bank_name
    "bank name": "bank_name",
    "bank_name": "bank_name",
    # bank_acc
    "bank account": "bank_acc",
    "bank_acc": "bank_acc",
    "account no": "bank_acc",
    "account number": "bank_acc",
    "bank account no": "bank_acc",
    # ifsc
    "ifsc": "ifsc",
    "ifsc code": "ifsc",
    "ifsc_code": "ifsc",
    # bank_branch
    "bank branch": "bank_branch",
    "bank_branch": "bank_branch",
    # present_addr
    "present address": "present_addr",
    "present_addr": "present_addr",
    "address": "present_addr",
    # present_city
    "present city": "present_city",
    "present_city": "present_city",
    "city": "present_city",
    # present_state
    "present state": "present_state",
    "present_state": "present_state",
    "state": "present_state",
    # present_pin
    "present pin": "present_pin",
    "present_pin": "present_pin",
    "pin code": "present_pin",
    "pincode": "present_pin",
    # perm_addr
    "permanent address": "perm_addr",
    "perm_addr": "perm_addr",
    "perm address": "perm_addr",
    # perm_city
    "permanent city": "perm_city",
    "perm_city": "perm_city",
    "perm city": "perm_city",
    # perm_state
    "permanent state": "perm_state",
    "perm_state": "perm_state",
    "perm state": "perm_state",
    # perm_pin
    "permanent pin": "perm_pin",
    "perm_pin": "perm_pin",
    "perm pin": "perm_pin",
    # status
    "status": "status",
}

# Map abbreviations/synonyms to the gender values the DB CHECK allows.
_GENDER_MAP = {
    "m": "male",
    "f": "female",
    "male": "male",
    "female": "female",
    "other": "other",
    "o": "other",
}


# ---------------------------------------------------------------------------
# Cell-level helpers
# ---------------------------------------------------------------------------

def _safe_int(val: Any) -> int:
    """Convert a cell value to int, defaulting to 0 on blank/invalid."""
    try:
        v = str(val).strip()
        return int(float(v)) if v else 0
    except (ValueError, TypeError):
        return 0


def _safe_float(val: Any) -> float:
    """Convert a cell value to float, defaulting to 0.0 on blank/invalid."""
    try:
        v = str(val).strip()
        return float(v) if v else 0.0
    except (ValueError, TypeError):
        return 0.0


def _to_str(val: Any) -> Optional[str]:
    """Convert a cell value to a stripped string, or None for blank/NaN."""
    if val is None:
        return None
    if isinstance(val, float) and math.isnan(val):
        return None
    if isinstance(val, (pd.Timestamp, datetime)):
        return val.date().isoformat()
    s = str(val).strip()
    return s if s else None


def _parse_date(s: str) -> date:
    """Try common date formats; raise ValueError if none match."""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date: {s!r}")


# ---------------------------------------------------------------------------
# Row-level type coercion helpers (used during commit)
# ---------------------------------------------------------------------------

def _row_date(row: dict, key: str) -> Optional[date]:
    v = row.get(key, "")
    if not v:
        return None
    try:
        return _parse_date(str(v))
    except ValueError:
        return None


def _row_dec(row: dict, key: str) -> Optional[Decimal]:
    v = row.get(key)
    if not v:
        return None
    try:
        return Decimal(str(v).strip())
    except InvalidOperation:
        return None


def _row_bool(row: dict, key: str, default: bool = True) -> bool:
    v = str(row.get(key, "")).lower().strip()
    if v in ("true", "yes", "1", "y"):
        return True
    if v in ("false", "no", "0", "n"):
        return False
    return default


def _row_int(row: dict, key: str) -> Optional[int]:
    v = row.get(key)
    try:
        return int(str(v).strip()) if v else None
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Code generation
# ---------------------------------------------------------------------------

def generate_emp_code(entity_id: str, db: Session) -> str:
    """
    Generate the next available emp_code for the given entity.
    Uses SELECT FOR UPDATE to prevent race conditions on concurrent creates.
    Format: entity.prefix + 6-digit zero-padded serial (e.g. UP000002)
    """
    from app.models.employee import Employee, Entity

    entity = db.get(Entity, entity_id)
    if not entity:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")

    prefix = entity.prefix

    # Lock the highest existing code row to block concurrent generates
    last = (
        db.query(Employee)
        .filter(Employee.emp_code.like(f"{prefix}%"))
        .order_by(Employee.emp_code.desc())
        .limit(1)
        .with_for_update()
        .first()
    )

    serial = int(last.emp_code[len(prefix):]) + 1 if last else 1
    return f"{prefix}{serial:06d}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def parse_upload_file(file: UploadFile) -> list[dict]:
    """Read .csv or .xlsx, normalise column names, return list of raw dicts."""
    content = await file.read()
    filename = (file.filename or "").lower()

    if filename.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(content), keep_default_na=False)
    elif filename.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False)
    else:
        raise HTTPException(status_code=400, detail="Only .csv and .xlsx files are supported")

    # Strip whitespace from headers before mapping
    df.columns = [str(c).strip() for c in df.columns]

    # Rename matched columns to canonical schema names
    rename = {col: _COL_MAP[col.lower()] for col in df.columns if col.lower() in _COL_MAP}
    df = df.rename(columns=rename)

    # Drop fully-blank rows
    df = df.dropna(how="all")

    rows: list[dict] = []
    for _, row in df.iterrows():
        d: dict = {}
        for col in df.columns:
            v = _to_str(row[col])
            if v is not None:  # blank cells are skipped — rule 7
                d[col] = v
        rows.append(d)

    return rows


def validate_import_rows(rows: list[dict], db: Session) -> dict:
    """
    Validate each row against schema rules and DB reference data.
    Returns {valid, invalid, total, valid_count, error_count}.
    Does NOT write to the database.
    """
    from app.models.employee import Employee, Entity, Location

    # Pre-load reference sets in one query each
    valid_entity_ids = {e.id for e in db.query(Entity).all()}
    valid_location_ids = {loc.id for loc in db.query(Location).all()}
    existing_codes = {e.emp_code for e in db.query(Employee.emp_code).all()}

    # Detect emp_code duplicates within the upload file
    file_codes = [r.get("emp_code", "").strip() for r in rows if r.get("emp_code", "").strip()]
    dup_codes = {c for c, n in Counter(file_codes).items() if n > 1}

    valid: list[dict] = []
    invalid: list[dict] = []

    for idx, row in enumerate(rows, start=2):  # row 1 = header
        errors: list[str] = []
        row = dict(row)  # work on a copy so normalised values don't mutate the caller's list
        emp_code = row.get("emp_code", "").strip()

        # 1. emp_code format — blank means auto-generate, not an error
        if emp_code:
            if not _CODE_RE.match(emp_code):
                errors.append("invalid code format")
            elif emp_code in dup_codes:
                errors.append("duplicate in file")
            elif emp_code in existing_codes:
                errors.append("already exists in DB")

        # 2. name required
        if not row.get("name", "").strip():
            errors.append("missing name")

        # 3. mobile: one or more 10-digit numbers, multiples separated by "/"
        mobile_raw = row.get("mobile", "")
        if not _MOBILE_RE.match(mobile_raw.strip()):
            errors.append("invalid mobile")
        else:
            row["mobile"] = "/".join(p.strip() for p in mobile_raw.split("/"))

        # 4. entity_id must exist
        if row.get("entity_id", "") not in valid_entity_ids:
            errors.append("unknown entity")

        # 5. location_id must exist
        if row.get("location_id", "") not in valid_location_ids:
            errors.append("unknown location")

        # 6. doj: required, valid date, not future
        doj_str = row.get("doj", "").strip()
        if not doj_str:
            errors.append("missing doj")
        else:
            try:
                doj = _parse_date(doj_str)
                if doj > date.today():
                    errors.append("doj is in the future")
                else:
                    row["doj"] = doj.isoformat()
            except ValueError:
                errors.append("invalid doj format")

        # Normalise dob to ISO string if present
        dob_str = row.get("dob", "").strip()
        if dob_str:
            try:
                row["dob"] = _parse_date(dob_str).isoformat()
            except ValueError:
                errors.append("invalid dob format")

        if errors:
            invalid.append({"row": idx, "data": row, "errors": errors})
        else:
            valid.append(row)

    return {
        "valid": valid,
        "invalid": invalid,
        "total": len(rows),
        "valid_count": len(valid),
        "error_count": len(invalid),
    }


def _pgp_encrypt_local(db: Session, plaintext: str) -> bytes:
    return db.execute(
        select(func.pgp_sym_encrypt(plaintext, settings.ENCRYPTION_KEY))
    ).scalar()


def commit_import(
    valid_rows: list[dict],
    db: Session,
    imported_by: str,
    filename: str = "",
) -> dict:
    """
    Insert all valid rows as a single atomic transaction.
    Rolls back all inserts on any failure.
    """
    from app.models.employee import AuditLog, Employee, User

    now = datetime.now(timezone.utc)
    new_codes: list[str] = []

    try:
        for row in valid_rows:
            emp_code = row.get("emp_code", "").strip()
            if not emp_code:
                emp_code = generate_emp_code(row["entity_id"], db)

            basic           = _row_dec(row, "basic")
            hra             = _row_dec(row, "hra")
            spl             = _row_dec(row, "spl")
            cca             = _row_dec(row, "cca")
            leave_travel    = _row_dec(row, "leave_travel") or Decimal("0")
            other_allowance = _row_dec(row, "other_allowance") or Decimal("0")
            # Statutory gross excludes other_allowance
            gross = sum((v for v in [basic, hra, spl, cca, leave_travel] if v), Decimal("0"))

            aadhaar = row.get("aadhaar")
            bank_acc = row.get("bank_acc")

            # Normalise fields with DB CHECK constraints to lowercase.
            # gender CHECK accepts only 'male'/'female'/'other', so map
            # common abbreviations (m/f) and synonyms to the allowed values.
            gender_val = row.get("gender")
            gender_val = gender_val.strip().lower() if gender_val else None
            gender_val = _GENDER_MAP.get(gender_val, gender_val)
            status_val = (row.get("status") or "active").lower()

            emp = Employee(
                emp_code=emp_code,
                legacy_code=row.get("legacy_code"),
                name=row["name"].strip(),
                father_name=row.get("father_name"),
                dob=_row_date(row, "dob"),
                gender=gender_val,
                marital_status=row.get("marital_status"),
                blood_group=row.get("blood_group"),
                religion=row.get("religion"),
                mobile=row["mobile"].strip(),
                email=row.get("email"),
                doj=_row_date(row, "doj"),
                entity_id=row["entity_id"],
                location_id=row["location_id"],
                department_id=_row_int(row, "department_id"),
                division=row.get("division"),
                designation=row.get("designation"),
                grade_id=_row_int(row, "grade_id"),
                reporting_mgr_code=row.get("reporting_mgr_code"),
                shift_id=_row_int(row, "shift_id"),
                ctc_annual=_row_dec(row, "ctc_annual"),
                basic=basic,
                hra=hra,
                spl=spl,
                cca=cca,
                leave_travel=leave_travel,
                other_allowance=other_allowance,
                pf_applicable=_row_bool(row, "pf_applicable", True),
                esic_applicable=gross <= Decimal("21000"),
                pt_applicable=_row_bool(row, "pt_applicable", True),
                pan=row.get("pan"),
                aadhaar_enc=_pgp_encrypt_local(db, aadhaar) if aadhaar else None,
                uan=row.get("uan"),
                esic_no=row.get("esic_no"),
                bank_name=row.get("bank_name"),
                bank_acc_enc=_pgp_encrypt_local(db, bank_acc) if bank_acc else None,
                ifsc=row.get("ifsc"),
                bank_branch=row.get("bank_branch"),
                present_addr=row.get("present_addr"),
                present_city=row.get("present_city"),
                present_state=row.get("present_state"),
                present_pin=row.get("present_pin"),
                perm_addr=row.get("perm_addr"),
                perm_city=row.get("perm_city"),
                perm_state=row.get("perm_state"),
                perm_pin=row.get("perm_pin"),
                status=status_val,
                created_at=now,
                updated_at=now,
                created_by=imported_by,
            )
            db.add(emp)
            # Flush so the new code is visible to the next generate_emp_code query
            db.flush()

            mobile_last4 = row["mobile"].strip()[-4:]
            db.add(User(
                emp_code=emp_code,
                password_hash=hash_password(f"Udyogi@{mobile_last4}"),
                role="employee",
                is_first_login=True,
                is_active=True,
                created_at=now,
                updated_at=now,
            ))
            new_codes.append(emp_code)

        db.add(AuditLog(
            user_code=imported_by,
            action="BULK_IMPORT",
            table_name="employees",
            record_id="BULK",
            new_values={
                "count": len(new_codes),
                "filename": filename,
                "emp_codes": new_codes,
            },
        ))

        db.commit()
        return {"imported": len(new_codes), "codes": new_codes}

    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Bulk import failed — all changes rolled back: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Attendance CSV import (monthly, legacy HRMS format)
# ---------------------------------------------------------------------------

async def parse_attendance_csv(file: UploadFile, db: Session) -> list[dict]:
    """
    Parse the monthly attendance CSV.

    Header format:
        Emp Code, Employee Name, Total Days, Pay Days,
        P, A, L, R, C, E, S, H, OT Hours, Salary Flag, Flag, Remarks

    - Emp Code is the database emp_code (e.g. UM000001).
      Falls back to reading "HRMS Code" column for backward compatibility with old files;
      old slash codes (UPPL/2026/00001) are resolved via legacy_code lookup.
    - Rows where Emp Code is blank are skipped (legend/footer rows at bottom of file).
    """
    from app.models.employee import Employee as EmpModel

    content = await file.read()
    df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False)
    df.columns = [str(c).strip() for c in df.columns]

    # Build lookup set; also build legacy_code map for backward compat
    all_emps = db.query(EmpModel.emp_code, EmpModel.legacy_code).all()
    all_codes = {e.emp_code for e in all_emps}
    legacy_to_code = {e.legacy_code: e.emp_code for e in all_emps if e.legacy_code}

    rows: list[dict] = []

    for _, raw in df.iterrows():
        # Support new "UID" column and old "HRMS Code" column
        uid = str(raw.get("Emp Code", raw.get("HRMS Code", ""))).strip()
        if not uid:
            continue  # legend / blank row

        # Direct match first (UID = emp_code), then legacy fallback
        if uid in all_codes:
            emp_code = uid
        else:
            emp_code = legacy_to_code.get(uid)  # None → unmatched

        rows.append({
            "uid": uid,
            "emp_code": emp_code,          # None → unmatched
            "name": str(raw.get("Employee Name", "")).strip(),
            "total_days": _safe_int(raw.get("Total Days", "")),
            "pay_days": _safe_int(raw.get("Pay Days", "")),
            "days_p": _safe_int(raw.get("P", "")),
            "days_a": _safe_int(raw.get("A", "")),
            "days_lwp": _safe_int(raw.get("L", "")),
            "days_wo": _safe_int(raw.get("R", "")),
            "days_cl": _safe_int(raw.get("C", "")),
            "days_pl": _safe_int(raw.get("PL", raw.get("E", ""))),  # PL column (legacy "E" = old EL)
            "days_sl": _safe_int(raw.get("S", "")),
            "late_days": _safe_int(raw.get("LT", raw.get("Late", ""))),  # late-coming days (15.4)
            "days_h": _safe_int(raw.get("H", "")),
            "ot_hours": _safe_float(raw.get("OT Hours", "")),
            "salary_flag": str(raw.get("Salary Flag", "")).strip() or None,
            "remarks": str(raw.get("Remarks", "")).strip() or None,
        })

    return rows
