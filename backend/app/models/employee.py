from sqlalchemy import (
    BigInteger, Boolean, Column, Computed, Date, DateTime, ForeignKey,
    Integer, JSON, LargeBinary, Numeric, SmallInteger, String, Text, Time,
    FetchedValue, text as sa_text,
)
from sqlalchemy.orm import relationship

from app.core.db import Base


class Entity(Base):
    __tablename__ = "entities"

    id = Column(String(10), primary_key=True)
    name = Column(String(100), nullable=False)
    prefix = Column(String(4), nullable=False)
    address = Column(Text)
    gstn = Column(String(20))
    created_at = Column(DateTime(timezone=True))


class Location(Base):
    __tablename__ = "locations"

    id = Column(String(40), primary_key=True)
    name = Column(String(100), nullable=False)
    city = Column(String(50), nullable=False)
    state = Column(String(50), nullable=False)
    entity_id = Column(String(10), ForeignKey("entities.id"))
    lat = Column(Numeric(10, 7))
    lng = Column(Numeric(10, 7))
    radius_m = Column(Integer)
    pt_state_code = Column(String(20), nullable=False)
    gstn = Column(String(20))
    status = Column(String(10), nullable=False, server_default=sa_text("'active'"))
    phone = Column(String(20))
    created_at = Column(DateTime(timezone=True))

    entity = relationship("Entity")


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    entity_id = Column(String(10), ForeignKey("entities.id"))

    entity = relationship("Entity")


class Grade(Base):
    __tablename__ = "grades"

    id = Column(Integer, primary_key=True)
    code = Column(String(10), nullable=False)
    name = Column(String(50))
    entity_id = Column(String(10), ForeignKey("entities.id"))

    entity = relationship("Entity")


class Shift(Base):
    __tablename__ = "shifts"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), nullable=False)
    in_time = Column(Time, nullable=False)
    out_time = Column(Time, nullable=False)
    entity_id = Column(String(10), ForeignKey("entities.id"))

    entity = relationship("Entity")


class Employee(Base):
    __tablename__ = "employees"

    emp_code = Column(String(12), primary_key=True)
    legacy_code = Column(String(30))
    sap_code = Column(String(30))  # SAP employee code; unique when present
    name = Column(String(100), nullable=False)
    father_name = Column(String(100))
    dob = Column(Date)
    gender = Column(String(10))
    marital_status = Column(String(20))
    blood_group = Column(String(5))
    religion = Column(String(30))
    mobile = Column(String(64))  # optional; may hold several "/"-separated numbers
    email = Column(String(100))
    doj = Column(Date, nullable=False)
    entity_id = Column(String(10), ForeignKey("entities.id"), nullable=False)
    location_id = Column(String(40), ForeignKey("locations.id"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"))
    division = Column(String(50))
    designation = Column(String(100))
    grade_id = Column(Integer, ForeignKey("grades.id"))
    reporting_mgr_code = Column(String(12), ForeignKey("employees.emp_code"))
    shift_id = Column(Integer, ForeignKey("shifts.id"))
    ctc_annual = Column(Numeric(12, 2))
    basic = Column(Numeric(10, 2))
    hra = Column(Numeric(10, 2))
    spl = Column(Numeric(10, 2))
    cca = Column(Numeric(10, 2))
    leave_travel = Column(Numeric(10, 2), nullable=False, default=0)
    medical = Column(Numeric(10, 2), nullable=False, default=0)
    other_earning = Column(Numeric(10, 2), nullable=False, default=0)
    conveyance = Column(Numeric(10, 2), nullable=False, default=0)
    # other_allowance is RECORD-ONLY: ad-hoc extra paid outside the payslip, never in net/gross math.
    other_allowance = Column(Numeric(10, 2), nullable=False, default=0)
    category = Column(String(10), nullable=False, default='staff')  # director | staff | worker
    probation_days = Column(Integer, nullable=False, default=90)
    probation_end_date = Column(Date, nullable=True)
    is_on_probation = Column(Boolean, nullable=False, default=True)
    # HR-set date of confirmation — CL/SL accrual starts after this (Session 18).
    confirmation_date = Column(Date, nullable=True)
    pf_applicable = Column(Boolean)
    esic_applicable = Column(Boolean)
    pt_applicable = Column(Boolean)
    pan = Column(String(20))
    aadhaar_enc = Column(LargeBinary)
    uan = Column(String(20))
    esic_no = Column(String(20))
    pf_number = Column(String(30))
    bank_name = Column(String(50))
    bank_acc_enc = Column(LargeBinary)
    ifsc = Column(String(15))
    present_addr = Column(Text)
    perm_addr = Column(Text)
    profit_center_code = Column(String(30))
    profit_center_name = Column(String(100))
    cost_center_code = Column(String(30))
    cost_center_name = Column(String(100))
    resignation_date = Column(Date)
    # retirement_date is a DB generated column (dob + 60y) — read-only, never write it.
    retirement_date = Column(Date, server_default=FetchedValue())
    status = Column(String(15))
    exit_date = Column(Date)
    created_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_by = Column(String(12))

    entity = relationship("Entity")
    location = relationship("Location")
    department = relationship("Department")
    grade = relationship("Grade")
    shift = relationship("Shift")
    user = relationship("User", back_populates="employee", uselist=False)


class User(Base):
    __tablename__ = "users"

    emp_code = Column(String(12), ForeignKey("employees.emp_code"), primary_key=True)
    password_hash = Column(Text, nullable=False)
    role = Column(String(20), nullable=False)
    is_first_login = Column(Boolean)
    is_active = Column(Boolean)
    last_login = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))

    employee = relationship("Employee", back_populates="user")


class StatutoryConfig(Base):
    __tablename__ = "statutory_config"

    id = Column(Integer, primary_key=True)
    state_code = Column(String(10), nullable=False)
    gender = Column(String(10))
    gross_from = Column(Numeric(10, 2), nullable=False)
    gross_to = Column(Numeric(10, 2), nullable=False)
    monthly_amount = Column(Numeric(8, 2), nullable=False)
    feb_override = Column(Numeric(8, 2))
    annual_cap = Column(Numeric(8, 2))
    filing_freq = Column(String(20))
    due_day = Column(Integer)
    penalty_desc = Column(Text)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date)


class PayrollMonth(Base):
    __tablename__ = "payroll_months"

    id = Column(BigInteger, primary_key=True)
    emp_code = Column(String(12), ForeignKey("employees.emp_code"), nullable=False)
    year = Column(SmallInteger, nullable=False)
    month = Column(SmallInteger, nullable=False)
    basic = Column(Numeric(10, 2), nullable=False)
    hra = Column(Numeric(10, 2))
    spl = Column(Numeric(10, 2))
    cca = Column(Numeric(10, 2))
    leave_travel = Column(Numeric(10, 2))
    other_earning = Column(Numeric(10, 2))
    other_allowance = Column(Numeric(10, 2))
    gross = Column(Numeric(10, 2), nullable=False)
    pf_emp = Column(Numeric(8, 2))
    pf_ern = Column(Numeric(8, 2))
    esic_emp = Column(Numeric(8, 2))
    esic_ern = Column(Numeric(8, 2))
    pt = Column(Numeric(8, 2))
    loan_emi = Column(Numeric(8, 2))
    other_deduction = Column(Numeric(8, 2))
    ld = Column(Numeric(10, 2), nullable=False, default=0)                 # Late Deduction (15.4)
    total_deduction = Column(Numeric(10, 2), Computed("(((((pf_emp + esic_emp) + pt) + loan_emi) + other_deduction) + ld)", persisted=True))
    net_pay = Column(Numeric(10, 2), nullable=False)
    late_days = Column(Integer, nullable=False, default=0)
    absent_from_late = Column(Numeric(5, 2), nullable=False, default=0)
    ld_overridden = Column(Boolean, nullable=False, default=False)
    late_absent_overridden = Column(Boolean, nullable=False, default=False)
    period_start       = Column(Date, nullable=True)
    period_end         = Column(Date, nullable=True)
    total_working_days = Column(Integer, nullable=True)
    total_days = Column(SmallInteger)
    pay_days = Column(SmallInteger)
    days_p = Column(SmallInteger)
    days_a = Column(SmallInteger)
    days_lwp = Column(SmallInteger)
    days_wo = Column(SmallInteger)
    days_cl = Column(SmallInteger)
    days_pl = Column(SmallInteger)
    days_sl = Column(SmallInteger)
    days_h = Column(SmallInteger)
    ot_hours = Column(Numeric(5, 2))
    status = Column(String(15))
    salary_flag = Column(String(50))
    remarks = Column(Text)
    generated_at = Column(DateTime(timezone=True))
    generated_by = Column(String(12))
    locked_at = Column(DateTime(timezone=True))

    employee = relationship("Employee")


class AttendanceRaw(Base):
    __tablename__ = "attendance_raw"

    id = Column(BigInteger, primary_key=True)
    emp_code = Column(String(12), ForeignKey("employees.emp_code"), nullable=False)
    punch_time = Column(DateTime(timezone=True), nullable=False)
    punch_type = Column(String(5))
    source = Column(String(15))
    device_sn = Column(String(30))
    lat = Column(Numeric(10, 7))
    lng = Column(Numeric(10, 7))
    distance_m = Column(Integer)
    is_flagged = Column(Boolean)
    created_at = Column(DateTime(timezone=True))

    employee = relationship("Employee")


class AttendanceDaily(Base):
    __tablename__ = "attendance_daily"

    id = Column(BigInteger, primary_key=True)
    emp_code = Column(String(12), ForeignKey("employees.emp_code"), nullable=False)
    att_date = Column(Date, nullable=False)
    first_in = Column(DateTime(timezone=True))
    last_out = Column(DateTime(timezone=True))
    hours_worked = Column(Numeric(5, 2))
    ot_hours = Column(Numeric(5, 2))
    att_status = Column(String(10))
    shift_id = Column(Integer, ForeignKey("shifts.id"))
    location_id = Column(String(40), ForeignKey("locations.id"))
    source = Column(String(15))
    remarks = Column(Text)

    employee = relationship("Employee")
    shift = relationship("Shift")
    location = relationship("Location")


class BiometricMapping(Base):
    __tablename__ = "biometric_mapping"

    id = Column(Integer, primary_key=True)
    biometric_id = Column(String(20), nullable=False)
    emp_code = Column(String(12), ForeignKey("employees.emp_code"), nullable=False)
    device_sn = Column(String(30), nullable=False)
    location_id = Column(String(40), ForeignKey("locations.id"))
    is_active = Column(Boolean)
    created_at = Column(DateTime(timezone=True))

    employee = relationship("Employee")
    location = relationship("Location")


class EmployeeCategory(Base):
    __tablename__ = "employee_categories"

    id = Column(Integer, primary_key=True)
    name = Column(String(10), nullable=False, unique=True)
    has_leaves = Column(Boolean, nullable=False, default=False)
    no_work_no_pay = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=sa_text("now()"))


class LeavePolicy(Base):
    __tablename__ = "leave_policies"

    id = Column(Integer, primary_key=True)
    entity_id = Column(String(10), ForeignKey("entities.id"), nullable=False)
    category = Column(String(10), nullable=False, default='staff')
    leave_type = Column(String(5), nullable=False)
    annual_quota = Column(Numeric(5, 2), nullable=False)
    probation_accrual = Column(Boolean, nullable=False, default=False)
    carry_forward = Column(Boolean, nullable=False, default=False)
    encashment_allowed = Column(Boolean, nullable=False, default=False)
    min_balance_encashment = Column(Integer, nullable=False, default=28)
    effective_from = Column(Date, nullable=False, server_default=sa_text("CURRENT_DATE"))
    created_at = Column(DateTime(timezone=True), server_default=sa_text("now()"))

    entity = relationship("Entity")


class LeaveAccrualLog(Base):
    __tablename__ = "leave_accrual_log"

    id = Column(Integer, primary_key=True)
    emp_code = Column(String(12), ForeignKey("employees.emp_code"), nullable=False)
    leave_type = Column(String(5), nullable=False)
    accrual_date = Column(Date, nullable=False)
    days_credited = Column(Numeric(5, 2), nullable=False)
    reason = Column(String(100))
    created_at = Column(DateTime(timezone=True), server_default=sa_text("now()"))

    employee = relationship("Employee")


class LeaveBalance(Base):
    __tablename__ = "leave_balances"

    id = Column(Integer, primary_key=True)
    emp_code = Column(String(12), ForeignKey("employees.emp_code"), nullable=False)
    leave_type = Column(String(5), nullable=False)
    year = Column(SmallInteger, nullable=False)
    entitlement = Column(Numeric(5, 2))
    used = Column(Numeric(5, 2))
    balance = Column(Numeric(5, 2), Computed("(entitlement - used)", persisted=True))
    carried_forward = Column(Numeric(5, 2))
    accrued_ytd = Column(Numeric(5, 2))
    taken_ytd = Column(Numeric(5, 2))
    encashed_ytd = Column(Numeric(5, 2))

    employee = relationship("Employee")


class LeavePolicyConfig(Base):
    """Single editable policy set (CL/SL/PL) for all entities (15.7).
    annual_days is the per-leave-year quota; entitlement = years_of_service × this.
    (Distinct from the legacy per-entity `leave_policies` table / LeavePolicy model.)"""
    __tablename__ = "leave_policy"

    leave_type  = Column(String(5), primary_key=True)
    annual_days = Column(Numeric(5, 2), nullable=False)
    updated_at  = Column(DateTime(timezone=True), server_default=sa_text("now()"))


class LeaveRequest(Base):
    __tablename__ = "leave_requests"

    id          = Column(BigInteger, primary_key=True)
    emp_code    = Column(String(12), ForeignKey("employees.emp_code"), nullable=False)
    entity_id   = Column(String(10), nullable=True)
    leave_type  = Column(String(5), nullable=False)
    from_date   = Column(Date, nullable=False)
    to_date     = Column(Date, nullable=False)
    days        = Column(Numeric(4, 1), nullable=False)
    reason      = Column(Text)
    status      = Column(String(15), default="pending")
    # legacy columns (used by /apply flow)
    approved_by = Column(String(12), ForeignKey("employees.emp_code"))
    approved_at = Column(DateTime(timezone=True))
    created_at  = Column(DateTime(timezone=True), server_default=sa_text("now()"))
    # new columns (used by /request flow)
    actioned_by = Column(String(20), nullable=True)
    actioned_on = Column(DateTime(timezone=True), nullable=True)
    reject_note = Column(Text, nullable=True)
    applied_on  = Column(DateTime(timezone=True), server_default=sa_text("now()"))

    employee = relationship("Employee", foreign_keys=[emp_code])
    approver = relationship("Employee", foreign_keys=[approved_by])


class Document(Base):
    __tablename__ = "documents"

    id = Column(BigInteger, primary_key=True)
    emp_code = Column(String(12), ForeignKey("employees.emp_code"), nullable=False)
    doc_type = Column(String(30), nullable=False)
    file_name = Column(String(200), nullable=False)
    file_path = Column(Text, nullable=False)
    file_size_kb = Column(Integer)
    uploaded_by = Column(String(12), ForeignKey("employees.emp_code"))
    uploaded_at = Column(DateTime(timezone=True))
    is_verified = Column(Boolean)

    employee = relationship("Employee", foreign_keys=[emp_code])
    uploader = relationship("Employee", foreign_keys=[uploaded_by])


class Asset(Base):
    __tablename__ = "assets"

    id = Column(BigInteger, primary_key=True)
    asset_tag = Column(String(30), nullable=False)
    name = Column(String(100), nullable=False)
    asset_type = Column(String(30), nullable=False)
    entity_id = Column(String(10), ForeignKey("entities.id"))
    assigned_to = Column(String(12), ForeignKey("employees.emp_code"))
    assigned_date = Column(Date)
    returned_date = Column(Date)
    status = Column(String(20))
    purchase_date = Column(Date)
    purchase_value = Column(Numeric(10, 2))
    remarks = Column(Text)
    created_at = Column(DateTime(timezone=True))

    entity = relationship("Entity")
    employee = relationship("Employee")


class PublicHoliday(Base):
    __tablename__ = "public_holidays"

    id            = Column(Integer, primary_key=True)
    name          = Column(String(100), nullable=False)
    date          = Column(Date, nullable=False)
    location_id   = Column(String(10), nullable=True)
    is_restricted = Column(Boolean, nullable=False, default=False)
    created_by    = Column(String(20), nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=sa_text("now()"))


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(BigInteger, primary_key=True)
    user_code = Column(String(12))
    action = Column(String(50), nullable=False)
    table_name = Column(String(50))
    record_id = Column(String(50))
    old_values = Column(JSON)
    new_values = Column(JSON)
    ip_address = Column(String(45))
    session_id = Column(String(100))
    ts = Column(DateTime(timezone=True), server_default=sa_text("now()"))


class SalaryStructure(Base):
    __tablename__ = "salary_structures"

    id              = Column(Integer, primary_key=True)
    emp_code        = Column(String(20), ForeignKey("employees.emp_code"), nullable=False)
    effective_from  = Column(Date, nullable=False)
    effective_to    = Column(Date, nullable=True)   # NULL = currently active
    basic           = Column(Numeric(10, 2), nullable=False, default=0)
    hra             = Column(Numeric(10, 2), nullable=False, default=0)
    spl             = Column(Numeric(10, 2), nullable=False, default=0)
    cca             = Column(Numeric(10, 2), nullable=False, default=0)
    leave_travel    = Column(Numeric(10, 2), nullable=False, default=0)
    other_earning   = Column(Numeric(10, 2), nullable=False, default=0)
    other_allowance = Column(Numeric(10, 2), nullable=False, default=0)
    reason          = Column(String(20), nullable=False, default="increment")
    created_by      = Column(String(20), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=sa_text("now()"))


class Loan(Base):
    __tablename__ = "loans"

    id            = Column(Integer, primary_key=True)
    emp_code      = Column(String(12), ForeignKey("employees.emp_code"), nullable=False)
    loan_type     = Column(String(20), nullable=False, default="loan")
    principal     = Column(Numeric(12, 2), nullable=False)
    emi           = Column(Numeric(10, 2), nullable=False)
    tenure_months = Column(Integer, nullable=False)
    start_date    = Column(Date, nullable=False)
    end_date      = Column(Date, nullable=True)
    outstanding   = Column(Numeric(12, 2), nullable=False)
    status        = Column(String(12), nullable=False, default="active")
    remarks       = Column(Text, nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=sa_text("now()"))
    created_by    = Column(String(12), nullable=True)
    updated_at    = Column(DateTime(timezone=True), server_default=sa_text("now()"))

    employee = relationship("Employee")


class LoanEmiSchedule(Base):
    __tablename__ = "loan_emi_schedule"

    id              = Column(Integer, primary_key=True)
    loan_id         = Column(Integer, ForeignKey("loans.id", ondelete="CASCADE"), nullable=False)
    emp_code        = Column(String(12), ForeignKey("employees.emp_code"), nullable=False)
    year            = Column(SmallInteger, nullable=False)
    month           = Column(SmallInteger, nullable=False)
    scheduled_emi   = Column(Numeric(10, 2), nullable=False)
    actual_emi      = Column(Numeric(10, 2), nullable=False)
    is_overridden   = Column(Boolean, nullable=False, default=False)
    override_reason = Column(String(200), nullable=True)
    overridden_by   = Column(String(12), nullable=True)
    applied         = Column(Boolean, nullable=False, default=False)
    created_at      = Column(DateTime(timezone=True), server_default=sa_text("now()"))
