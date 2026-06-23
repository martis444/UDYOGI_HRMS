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
    # sap_code
    "sap code": "sap_code",
    "sap_code": "sap_code",
    "sap": "sap_code",
    "sap id": "sap_code",
    "sap emp code": "sap_code",
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

def _clean_legacy(val: Any) -> str | None:
    """Normalise legacy_code: blank or the placeholder '0' becomes None.

    legacy_code is UNIQUE in the DB, so empty/placeholder values must be NULL
    (Postgres allows many NULLs) rather than collide on a shared sentinel.
    """
    s = ("" if val is None else str(val)).strip()
    return None if s in ("", "0") else s


def _clean_str(val: Any) -> str | None:
    """Trimmed string, or None when blank."""
    s = ("" if val is None else str(val)).strip()
    return s or None


def _strip_ws(val: Any) -> str:
    """Remove every whitespace char (incl. non-breaking/zero-width) from a cell."""
    if val is None:
        return ""
    # \s covers ASCII + unicode spaces (incl. \xa0); add zero-width chars \s misses.
    return re.sub(r"[\s​‌‍﻿]+", "", str(val))


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


def _resolve_department(db: Session, raw: Any, entity_id: str, cache: dict) -> Optional[int]:
    """Resolve a department cell to departments.id.

    HR sheets put the department *name* (e.g. "ADMIN") in this column, but the
    DB stores an integer FK. Blank -> None; a number is used as the id directly;
    a name is looked up (case-insensitive) within the entity and created if new.
    """
    from app.models.employee import Department

    s = "" if raw is None else str(raw).strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)

    key = (entity_id, s.lower())
    if key in cache:
        return cache[key]
    dept = Department(name=s, entity_id=entity_id)
    db.add(dept)
    db.flush()  # assign dept.id
    cache[key] = dept.id
    return dept.id


# Plain text columns copied through verbatim on insert/update.
_TEXT_COLS = [
    "sap_code",
    "name", "father_name", "marital_status", "blood_group", "religion", "email",
    "division", "designation", "reporting_mgr_code", "pan", "uan", "esic_no",
    "bank_name", "ifsc", "bank_branch", "present_addr", "present_city",
    "present_state", "present_pin", "perm_addr", "perm_city", "perm_state",
    "perm_pin",
]


def _present(row: dict, key: str) -> bool:
    """True if the cell has a non-blank value (so it should be written)."""
    v = row.get(key)
    return v is not None and str(v).strip() != ""


def _apply_updates(emp, row: dict, db: Session, dept_cache: dict, now: datetime) -> None:
    """Update an existing employee from non-blank cells only (rule 7).

    Never touches emp_code (immutable, rule 3). Recomputes esic_applicable
    whenever a salary component changes (rule 4).
    """
    for col in _TEXT_COLS:
        if _present(row, col):
            v = row[col]
            setattr(emp, col, v.strip() if isinstance(v, str) else v)

    # mobile/legacy_code are normalised to a value or None during validation
    if row.get("legacy_code") is not None:
        emp.legacy_code = row["legacy_code"]
    if row.get("mobile") is not None:
        emp.mobile = row["mobile"]

    if _present(row, "dob"):
        emp.dob = _row_date(row, "dob")
    if _present(row, "doj"):
        emp.doj = _row_date(row, "doj")
    if _present(row, "entity_id"):
        emp.entity_id = row["entity_id"]
    if _present(row, "location_id"):
        emp.location_id = row["location_id"]
    if _present(row, "department_id"):
        emp.department_id = _resolve_department(db, row["department_id"], emp.entity_id, dept_cache)
    if _present(row, "grade_id"):
        emp.grade_id = _row_int(row, "grade_id")
    if _present(row, "shift_id"):
        emp.shift_id = _row_int(row, "shift_id")

    if _present(row, "gender"):
        g = str(row["gender"]).strip().lower()
        emp.gender = _GENDER_MAP.get(g, g)
    if _present(row, "status"):
        emp.status = str(row["status"]).strip().lower()

    salary_changed = False
    for col in ["ctc_annual", "basic", "hra", "spl", "cca", "leave_travel", "other_allowance"]:
        if _present(row, col):
            setattr(emp, col, _row_dec(row, col))
            if col in ("basic", "hra", "spl", "cca", "leave_travel"):
                salary_changed = True

    if _present(row, "pf_applicable"):
        emp.pf_applicable = _row_bool(row, "pf_applicable")
    if _present(row, "pt_applicable"):
        emp.pt_applicable = _row_bool(row, "pt_applicable")

    if _present(row, "aadhaar"):
        emp.aadhaar_enc = _pgp_encrypt_local(db, str(row["aadhaar"]))
    if _present(row, "bank_acc"):
        emp.bank_acc_enc = _pgp_encrypt_local(db, str(row["bank_acc"]))

    # rule 4: recompute ESIC eligibility on any salary change
    if salary_changed:
        gross = sum(
            (v for v in [emp.basic, emp.hra, emp.spl, emp.cca, emp.leave_travel] if v),
            Decimal("0"),
        )
        emp.esic_applicable = gross <= Decimal("21000")

    emp.updated_at = now


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
    existing_legacy = {
        e.legacy_code for e in db.query(Employee.legacy_code).all() if e.legacy_code
    }
    # sap_code / legacy_code -> emp_code, so we can match rows to employees and
    # tell a row's own SAP code apart from a clash with a *different* employee.
    legacy_to_code = {
        lc: ec for ec, lc in db.query(Employee.emp_code, Employee.legacy_code).all() if lc
    }
    sap_to_code = {
        sc: ec for ec, sc in db.query(Employee.emp_code, Employee.sap_code).all() if sc
    }

    # Detect emp_code duplicates within the upload file
    file_codes = [r.get("emp_code", "").strip() for r in rows if r.get("emp_code", "").strip()]
    dup_codes = {c for c, n in Counter(file_codes).items() if n > 1}

    # Detect legacy_code duplicates within the upload file (real codes only;
    # blank and "0" are placeholders that become NULL and don't conflict)
    file_legacy = [_clean_legacy(r.get("legacy_code")) for r in rows]
    dup_legacy = {c for c, n in Counter(c for c in file_legacy if c).items() if n > 1}

    # Detect sap_code duplicates within the upload file
    file_sap = [_clean_str(r.get("sap_code")) for r in rows]
    dup_sap = {c for c, n in Counter(c for c in file_sap if c).items() if n > 1}

    valid: list[dict] = []
    invalid: list[dict] = []

    for idx, row in enumerate(rows, start=2):  # row 1 = header
        # Each error names the offending column so the UI report is actionable.
        errors: list[dict] = []
        row = dict(row)  # work on a copy so normalised values don't mutate the caller's list
        emp_code = row.get("emp_code", "").strip()
        legacy = _clean_legacy(row.get("legacy_code"))
        row["legacy_code"] = legacy
        sap = _clean_str(row.get("sap_code"))
        row["sap_code"] = sap

        # An existing employee (matched by emp_code or legacy_code) is an UPDATE,
        # not a duplicate-error. Required fields are only enforced on new inserts;
        # for updates a blank cell means "leave unchanged" (rule 7).
        match_code = None
        if emp_code and emp_code in existing_codes:
            match_code = emp_code
        elif legacy and legacy in legacy_to_code:
            match_code = legacy_to_code[legacy]
        is_update = match_code is not None
        row["_mode"] = "update" if is_update else "insert"

        # sap_code: optional, unique when present. In-file dup is an error; a DB
        # clash is only an error if the SAP code belongs to a *different* employee.
        if sap:
            if sap in dup_sap:
                errors.append({"column": "sap_code", "error": "duplicate in file"})
            elif sap in sap_to_code and sap_to_code[sap] != match_code:
                errors.append({"column": "sap_code", "error": "already exists in DB"})

        # 1. emp_code format / in-file duplicates (existing-in-DB is fine → update)
        if emp_code:
            if not _CODE_RE.match(emp_code):
                errors.append({"column": "emp_code", "error": "invalid code format"})
            elif emp_code in dup_codes:
                errors.append({"column": "emp_code", "error": "duplicate in file"})

        # 1b. legacy_code: optional. Blank/"0" → NULL. In-file dup is an error;
        #     matching an existing employee is an update, not an error.
        if legacy and legacy in dup_legacy:
            errors.append({"column": "legacy_code", "error": "duplicate in file"})

        # 2. name required on insert
        if not is_update and not row.get("name", "").strip():
            errors.append({"column": "name", "error": "missing name"})

        # 3. mobile: optional. When present, one or more 10-digit numbers,
        #    multiples separated by "/". Strip ALL whitespace first (incl.
        #    non-breaking/zero-width spaces from Excel) so a stray space doesn't
        #    fail an otherwise-valid cell.
        mobile_clean = _strip_ws(row.get("mobile", ""))
        if not mobile_clean:
            row["mobile"] = None
        elif not _MOBILE_RE.match(mobile_clean):
            errors.append({"column": "mobile", "error": "invalid mobile"})
        else:
            row["mobile"] = mobile_clean

        # 4. entity_id: required on insert; if given on update, must be valid
        entity = row.get("entity_id", "")
        if entity:
            if entity not in valid_entity_ids:
                errors.append({"column": "entity_id", "error": "unknown entity"})
        elif not is_update:
            errors.append({"column": "entity_id", "error": "unknown entity"})

        # 5. location_id: required on insert; if given on update, must be valid
        location = row.get("location_id", "")
        if location:
            if location not in valid_location_ids:
                errors.append({"column": "location_id", "error": "unknown location"})
        elif not is_update:
            errors.append({"column": "location_id", "error": "unknown location"})

        # 6. doj: required on insert; if given, must be a valid past date
        doj_str = row.get("doj", "").strip()
        if doj_str:
            try:
                doj = _parse_date(doj_str)
                if doj > date.today():
                    errors.append({"column": "doj", "error": "doj is in the future"})
                else:
                    row["doj"] = doj.isoformat()
            except ValueError:
                errors.append({"column": "doj", "error": "invalid doj format"})
        elif not is_update:
            errors.append({"column": "doj", "error": "missing doj"})

        # Normalise dob to ISO string if present
        dob_str = row.get("dob", "").strip()
        if dob_str:
            try:
                row["dob"] = _parse_date(dob_str).isoformat()
            except ValueError:
                errors.append({"column": "dob", "error": "invalid dob format"})

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
    Apply all valid rows as a single atomic transaction: rows matching an
    existing employee (by emp_code or legacy_code) are updated, the rest are
    inserted. Rolls back everything on any failure.
    """
    from app.models.employee import AuditLog, Department, Employee, User

    now = datetime.now(timezone.utc)
    new_codes: list[str] = []
    updated_codes: list[str] = []

    # (entity_id, lower(name)) -> id, so department names resolve to FK ids and
    # newly-seen departments are created once per batch, not per row.
    dept_cache = {
        (d.entity_id, d.name.lower()): d.id for d in db.query(Department).all()
    }
    # Resolve existing employees so re-uploads update rather than collide.
    existing_codes = {e.emp_code for e in db.query(Employee.emp_code).all()}
    legacy_to_code = {
        lc: ec
        for ec, lc in db.query(Employee.emp_code, Employee.legacy_code).all()
        if lc
    }

    try:
        for row in valid_rows:
            emp_code = row.get("emp_code", "").strip()
            legacy = _clean_legacy(row.get("legacy_code"))

            # UPDATE path: row matches an existing employee.
            match_code = None
            if emp_code and emp_code in existing_codes:
                match_code = emp_code
            elif legacy and legacy in legacy_to_code:
                match_code = legacy_to_code[legacy]
            if match_code:
                emp = db.query(Employee).filter(Employee.emp_code == match_code).first()
                _apply_updates(emp, row, db, dept_cache, now)
                updated_codes.append(match_code)
                continue

            # INSERT path.
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
                sap_code=row.get("sap_code"),
                name=row["name"].strip(),
                father_name=row.get("father_name"),
                dob=_row_date(row, "dob"),
                gender=gender_val,
                marital_status=row.get("marital_status"),
                blood_group=row.get("blood_group"),
                religion=row.get("religion"),
                mobile=row.get("mobile"),  # already normalised (or None) in validation
                email=row.get("email"),
                doj=_row_date(row, "doj"),
                entity_id=row["entity_id"],
                location_id=row["location_id"],
                department_id=_resolve_department(db, row.get("department_id"), row["entity_id"], dept_cache),
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

            # Default login password ends in the last 4 digits of the mobile;
            # fall back to the emp_code when no mobile was provided.
            mobile = row.get("mobile")
            last4 = (mobile.strip() if mobile else emp_code)[-4:]
            db.add(User(
                emp_code=emp_code,
                password_hash=hash_password(f"Udyogi@{last4}"),
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
                "updated": len(updated_codes),
                "filename": filename,
                "emp_codes": new_codes,
                "updated_codes": updated_codes,
            },
        ))

        db.commit()
        return {
            "imported": len(new_codes),
            "updated": len(updated_codes),
            "codes": new_codes,
            "updated_codes": updated_codes,
        }

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
