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

    # Required
    name: str
    mobile: str
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
    other_allowance: Optional[Decimal] = Decimal("0")

    # Category / probation
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
    bank_branch: Optional[str] = None

    # Present address
    present_addr: Optional[str] = None
    present_city: Optional[str] = None
    present_state: Optional[str] = None
    present_pin: Optional[str] = None

    # Permanent address
    perm_addr: Optional[str] = None
    perm_city: Optional[str] = None
    perm_state: Optional[str] = None
    perm_pin: Optional[str] = None

    # Status
    status: Optional[str] = "active"
    exit_date: Optional[date] = None

    @field_validator("mobile")
    @classmethod
    def validate_mobile(cls, v: str) -> str:
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


class EmployeeUpdate(BaseModel):
    # All optional for partial updates. emp_code is intentionally absent.
    legacy_code: Optional[str] = None
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
    other_allowance: Optional[Decimal] = None
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
    bank_branch: Optional[str] = None
    present_addr: Optional[str] = None
    present_city: Optional[str] = None
    present_state: Optional[str] = None
    present_pin: Optional[str] = None
    perm_addr: Optional[str] = None
    perm_city: Optional[str] = None
    perm_state: Optional[str] = None
    perm_pin: Optional[str] = None
    status: Optional[str] = None
    exit_date: Optional[date] = None

    @field_validator("mobile")
    @classmethod
    def validate_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
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


class EmployeeListItem(BaseModel):
    emp_code: str
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
    name: str
    father_name: Optional[str] = None
    dob: Optional[date] = None
    gender: Optional[str] = None
    marital_status: Optional[str] = None
    blood_group: Optional[str] = None
    religion: Optional[str] = None
    mobile: str
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
    other_allowance: Optional[Decimal] = None
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
    bank_branch: Optional[str] = None
    present_addr: Optional[str] = None
    present_city: Optional[str] = None
    present_state: Optional[str] = None
    present_pin: Optional[str] = None
    perm_addr: Optional[str] = None
    perm_city: Optional[str] = None
    perm_state: Optional[str] = None
    perm_pin: Optional[str] = None
    status: Optional[str] = None
    exit_date: Optional[date] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None
