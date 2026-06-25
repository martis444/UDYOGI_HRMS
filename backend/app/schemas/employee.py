import re
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, field_validator


# One or more 10-digit mobile numbers; multiples separated by "/" (spaces ok).
# e.g. "9876543210" or "9876543210/9123456780/9000000001"
_MOBILE_RE = re.compile(r"^\d{10}(\s*/\s*\d{10})*$")


def _normalise_mobiles(v: str) -> str:
    """Validate one-or-more 10-digit numbers and return them as 'a/b/c' (no spaces)."""
    if not _MOBILE_RE.match(v.strip()):
        raise ValueError("mobile must be 10 digits; separate multiple numbers with '/'")
    return "/".join(p.strip() for p in v.split("/"))


# Map abbreviations/synonyms to the gender values the DB CHECK allows.
_GENDER_MAP = {"m": "male", "f": "female", "o": "other"}


def _normalise_gender(v: Optional[str]) -> Optional[str]:
    if not isinstance(v, str):
        return v
    g = v.strip().lower()
    return _GENDER_MAP.get(g, g)


class EmployeeCreate(BaseModel):
    # Optional — auto-generated if blank
    emp_code: Optional[str] = None
    legacy_code: Optional[str] = None
    sap_code: Optional[str] = None  # SAP employee code (unique when present)

    # Required
    name: str
    doj: date
    entity_id: str
    location_id: str

    # Personal
    father_name: Optional[str] = None
    dob: Optional[date] = None
    gender: Optional[str] = None
    marital_status: Optional[str] = None
    blood_group: Optional[str] = None
    religion: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None

    # Org
    department_id: Optional[int] = None
    division: Optional[str] = None
    designation: Optional[str] = None
    grade_id: Optional[int] = None
    reporting_mgr_code: Optional[str] = None
    shift_id: Optional[int] = None

    # Salary
    ctc_annual: Optional[Decimal] = None
    basic: Optional[Decimal] = None
    hra: Optional[Decimal] = None
    spl: Optional[Decimal] = None
    cca: Optional[Decimal] = None
    leave_travel: Optional[Decimal] = Decimal("0")
    medical: Optional[Decimal] = Decimal("0")
    other_earning: Optional[Decimal] = Decimal("0")
    # Record-only ad-hoc payout (NOT counted in payslip/net) — manual.
    other_allowance: Optional[Decimal] = Decimal("0")

    # Org costing
    profit_center_code: Optional[str] = None
    profit_center_name: Optional[str] = None
    cost_center_code: Optional[str] = None
    cost_center_name: Optional[str] = None

    # Category / probation. category: director | staff | worker
    category: Optional[str] = 'staff'
    probation_days: Optional[int] = 90
    probation_end_date: Optional[date] = None

    # Statutory flags
    pf_applicable: bool = True
    pt_applicable: bool = True
    # esic_applicable is auto-computed from gross — not accepted as input

    # Statutory IDs (plain text — encrypted before storage)
    pan: Optional[str] = None
    aadhaar: Optional[str] = None
    uan: Optional[str] = None
    esic_no: Optional[str] = None
    pf_number: Optional[str] = None

    # Bank (plain text — encrypted before storage)
    bank_name: Optional[str] = None
    bank_acc: Optional[str] = None
    ifsc: Optional[str] = None

    # Address (full text only — city/state/pin breakdown removed)
    present_addr: Optional[str] = None
    perm_addr: Optional[str] = None

    # Status / exit
    status: Optional[str] = "active"
    exit_date: Optional[date] = None
    resignation_date: Optional[date] = None

    @field_validator("mobile")
    @classmethod
    def validate_mobile(cls, v: Optional[str]) -> Optional[str]:
        if not v or not v.strip():
            return None
        return _normalise_mobiles(v)

    @field_validator("pan")
    @classmethod
    def validate_pan(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", v):
            raise ValueError("PAN must match format ABCDE1234F")
        return v

    @field_validator("doj")
    @classmethod
    def validate_doj(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("date of joining cannot be in the future")
        return v

    @field_validator("marital_status", "status", "category", mode="before")
    @classmethod
    def normalise_lowercase(cls, v: Optional[str]) -> Optional[str]:
        return v.lower() if isinstance(v, str) else v

    @field_validator("gender", mode="before")
    @classmethod
    def normalise_gender(cls, v: Optional[str]) -> Optional[str]:
        return _normalise_gender(v)

    @field_validator("sap_code", "legacy_code", mode="before")
    @classmethod
    def blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        # Blank must be NULL so the unique-when-present index allows many blanks.
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class EmployeeUpdate(BaseModel):
    # All optional for partial updates. emp_code is intentionally absent.
    legacy_code: Optional[str] = None
    sap_code: Optional[str] = None
    name: Optional[str] = None
    father_name: Optional[str] = None
    dob: Optional[date] = None
    gender: Optional[str] = None
    marital_status: Optional[str] = None
    blood_group: Optional[str] = None
    religion: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    doj: Optional[date] = None
    location_id: Optional[str] = None
    department_id: Optional[int] = None
    division: Optional[str] = None
    designation: Optional[str] = None
    grade_id: Optional[int] = None
    reporting_mgr_code: Optional[str] = None
    shift_id: Optional[int] = None
    ctc_annual: Optional[Decimal] = None
    basic: Optional[Decimal] = None
    hra: Optional[Decimal] = None
    spl: Optional[Decimal] = None
    cca: Optional[Decimal] = None
    leave_travel: Optional[Decimal] = None
    medical: Optional[Decimal] = None
    other_earning: Optional[Decimal] = None
    other_allowance: Optional[Decimal] = None  # record-only ad-hoc payout
    profit_center_code: Optional[str] = None
    profit_center_name: Optional[str] = None
    cost_center_code: Optional[str] = None
    cost_center_name: Optional[str] = None
    category: Optional[str] = None
    probation_days: Optional[int] = None
    probation_end_date: Optional[date] = None
    pf_applicable: Optional[bool] = None
    pt_applicable: Optional[bool] = None
    pan: Optional[str] = None
    aadhaar: Optional[str] = None
    uan: Optional[str] = None
    esic_no: Optional[str] = None
    pf_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_acc: Optional[str] = None
    ifsc: Optional[str] = None
    present_addr: Optional[str] = None
    perm_addr: Optional[str] = None
    status: Optional[str] = None
    exit_date: Optional[date] = None
    resignation_date: Optional[date] = None

    @field_validator("mobile")
    @classmethod
    def validate_mobile(cls, v: Optional[str]) -> Optional[str]:
        if not v or not v.strip():
            return None
        return _normalise_mobiles(v)

    @field_validator("pan")
    @classmethod
    def validate_pan(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", v):
            raise ValueError("PAN must match format ABCDE1234F")
        return v

    @field_validator("marital_status", "status", "category", mode="before")
    @classmethod
    def normalise_lowercase(cls, v: Optional[str]) -> Optional[str]:
        return v.lower() if isinstance(v, str) else v

    @field_validator("gender", mode="before")
    @classmethod
    def normalise_gender(cls, v: Optional[str]) -> Optional[str]:
        return _normalise_gender(v)

    @field_validator("sap_code", "legacy_code", mode="before")
    @classmethod
    def blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        # Blank must be NULL so the unique-when-present index allows many blanks.
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class EmployeeListItem(BaseModel):
    emp_code: str
    sap_code: Optional[str] = None
    name: str
    entity_id: str
    location_city: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    grade: Optional[str] = None
    status: Optional[str] = None


class EmployeeListResponse(BaseModel):
    items: List[EmployeeListItem]
    total: int
    page: int
    per_page: int


class EmployeeResponse(BaseModel):
    emp_code: str
    legacy_code: Optional[str] = None
    sap_code: Optional[str] = None
    name: str
    father_name: Optional[str] = None
    dob: Optional[date] = None
    gender: Optional[str] = None
    marital_status: Optional[str] = None
    blood_group: Optional[str] = None
    religion: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    doj: date
    entity_id: str
    location_id: str
    department_id: Optional[int] = None
    division: Optional[str] = None
    designation: Optional[str] = None
    grade_id: Optional[int] = None
    reporting_mgr_code: Optional[str] = None
    shift_id: Optional[int] = None
    ctc_annual: Optional[Decimal] = None
    basic: Optional[Decimal] = None
    hra: Optional[Decimal] = None
    spl: Optional[Decimal] = None
    cca: Optional[Decimal] = None
    leave_travel: Optional[Decimal] = None
    medical: Optional[Decimal] = None
    other_earning: Optional[Decimal] = None
    other_allowance: Optional[Decimal] = None  # record-only ad-hoc payout
    profit_center_code: Optional[str] = None
    profit_center_name: Optional[str] = None
    cost_center_code: Optional[str] = None
    cost_center_name: Optional[str] = None
    monthly_gross: Decimal = Decimal("0")
    category: Optional[str] = None
    probation_days: Optional[int] = None
    probation_end_date: Optional[date] = None
    is_on_probation: Optional[bool] = None
    pf_applicable: Optional[bool] = None
    esic_applicable: Optional[bool] = None
    pt_applicable: Optional[bool] = None
    pan: Optional[str] = None
    aadhaar: Optional[str] = None      # masked: XXXX XXXX 1234
    uan: Optional[str] = None
    esic_no: Optional[str] = None
    pf_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_acc: Optional[str] = None     # masked: XXXX 1234
    ifsc: Optional[str] = None
    present_addr: Optional[str] = None
    perm_addr: Optional[str] = None
    status: Optional[str] = None
    exit_date: Optional[date] = None
    resignation_date: Optional[date] = None
    retirement_date: Optional[date] = None  # auto = DOB + 60y (read-only)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None
