--
-- PostgreSQL database dump
--

\restrict QDtJeKLEMJ6FCvuJU8f0TBNxSYs6qafNBNIGAY01IkrUmpwir3AtobfbpX6H26X

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: protect_company_figures(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_company_figures() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  protected text[] := ARRAY['UP000001','UP000002','UP000003','UP000004',
                            'UP000005','UP000006','UP000007','UP000008'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.emp_code = ANY(protected) THEN
      RAISE EXCEPTION 'Protected company figure % cannot be deleted', OLD.emp_code;
    END IF;
    RETURN OLD;
  ELSE  -- UPDATE
    IF OLD.emp_code = ANY(protected) AND NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION 'Name of protected company figure % cannot be changed', OLD.emp_code;
    END IF;
    RETURN NEW;
  END IF;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id bigint NOT NULL,
    asset_tag character varying(30) NOT NULL,
    name character varying(100) NOT NULL,
    asset_type character varying(30) NOT NULL,
    entity_id character varying(10),
    assigned_to character varying(12),
    assigned_date date,
    returned_date date,
    status character varying(20) DEFAULT 'available'::character varying,
    purchase_date date,
    purchase_value numeric(10,2),
    remarks text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT assets_status_check CHECK (((status)::text = ANY ((ARRAY['available'::character varying, 'assigned'::character varying, 'maintenance'::character varying, 'retired'::character varying])::text[])))
);


--
-- Name: assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.assets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.assets_id_seq OWNED BY public.assets.id;


--
-- Name: attendance_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_daily (
    id bigint NOT NULL,
    emp_code character varying(12) NOT NULL,
    att_date date NOT NULL,
    first_in timestamp with time zone,
    last_out timestamp with time zone,
    hours_worked numeric(5,2),
    ot_hours numeric(5,2) DEFAULT 0,
    att_status character varying(10) DEFAULT 'absent'::character varying,
    shift_id integer,
    location_id character varying(40),
    source character varying(15) DEFAULT 'biometric'::character varying,
    remarks text,
    CONSTRAINT attendance_daily_att_status_check CHECK (((att_status)::text = ANY ((ARRAY['present'::character varying, 'absent'::character varying, 'halfday'::character varying, 'late'::character varying, 'lwp'::character varying, 'cl'::character varying, 'pl'::character varying, 'sl'::character varying, 'holiday'::character varying, 'wo'::character varying])::text[])))
);


--
-- Name: attendance_daily_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_daily_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_daily_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_daily_id_seq OWNED BY public.attendance_daily.id;


--
-- Name: attendance_raw; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_raw (
    id bigint NOT NULL,
    emp_code character varying(12) NOT NULL,
    punch_time timestamp with time zone NOT NULL,
    punch_type character varying(5),
    source character varying(15) DEFAULT 'biometric'::character varying,
    device_sn character varying(30),
    lat numeric(10,7),
    lng numeric(10,7),
    distance_m integer,
    is_flagged boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT attendance_raw_punch_type_check CHECK (((punch_type)::text = ANY ((ARRAY['IN'::character varying, 'OUT'::character varying, 'UNKNOWN'::character varying])::text[]))),
    CONSTRAINT attendance_raw_source_check CHECK (((source)::text = ANY ((ARRAY['biometric'::character varying, 'geo'::character varying, 'manual'::character varying])::text[])))
);


--
-- Name: attendance_raw_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_raw_id_seq OWNED BY public.attendance_raw.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    user_code character varying(12),
    action character varying(50) NOT NULL,
    table_name character varying(50),
    record_id character varying(50),
    old_values jsonb,
    new_values jsonb,
    ip_address character varying(45),
    session_id character varying(100),
    ts timestamp with time zone DEFAULT now()
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: biometric_mapping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biometric_mapping (
    id integer NOT NULL,
    biometric_id character varying(20) NOT NULL,
    emp_code character varying(12) NOT NULL,
    device_sn character varying(30) NOT NULL,
    location_id character varying(40),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: biometric_mapping_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.biometric_mapping_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: biometric_mapping_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.biometric_mapping_id_seq OWNED BY public.biometric_mapping.id;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    entity_id character varying(10)
);


--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.departments_id_seq OWNED BY public.departments.id;


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id bigint NOT NULL,
    emp_code character varying(12) NOT NULL,
    doc_type character varying(30) NOT NULL,
    file_name character varying(200) NOT NULL,
    file_path text NOT NULL,
    file_size_kb integer,
    uploaded_by character varying(12),
    uploaded_at timestamp with time zone DEFAULT now(),
    is_verified boolean DEFAULT false
);


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documents_id_seq OWNED BY public.documents.id;


--
-- Name: employee_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_categories (
    id integer NOT NULL,
    name character varying(10) NOT NULL,
    has_leaves boolean DEFAULT false NOT NULL,
    no_work_no_pay boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_categories_name_check CHECK (((name)::text = ANY (ARRAY[('director'::character varying)::text, ('staff'::character varying)::text, ('worker'::character varying)::text])))
);


--
-- Name: employee_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_categories_id_seq OWNED BY public.employee_categories.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    emp_code character varying(12) NOT NULL,
    legacy_code character varying(30),
    name character varying(100) NOT NULL,
    father_name character varying(100),
    dob date,
    gender character varying(10),
    marital_status character varying(20),
    blood_group character varying(5),
    religion character varying(30),
    mobile character varying(64),
    email character varying(100),
    doj date NOT NULL,
    entity_id character varying(10) NOT NULL,
    location_id character varying(40) NOT NULL,
    department_id integer,
    division character varying(50),
    designation character varying(100),
    grade_id integer,
    reporting_mgr_code character varying(12),
    shift_id integer,
    ctc_annual numeric(12,2) DEFAULT 0,
    basic numeric(10,2) DEFAULT 0,
    hra numeric(10,2) DEFAULT 0,
    spl numeric(10,2) DEFAULT 0,
    cca numeric(10,2) DEFAULT 0,
    pf_applicable boolean DEFAULT true,
    esic_applicable boolean DEFAULT true,
    pt_applicable boolean DEFAULT true,
    pan character varying(20),
    aadhaar_enc bytea,
    uan character varying(20),
    esic_no character varying(20),
    bank_name character varying(50),
    bank_acc_enc bytea,
    ifsc character varying(15),
    present_addr text,
    perm_addr text,
    status character varying(15) DEFAULT 'active'::character varying,
    exit_date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by character varying(12),
    leave_travel numeric(10,2) DEFAULT 0 NOT NULL,
    other_allowance numeric(10,2) DEFAULT 0 NOT NULL,
    category character varying(10) DEFAULT 'staff'::character varying NOT NULL,
    probation_days integer DEFAULT 90 NOT NULL,
    probation_end_date date,
    is_on_probation boolean DEFAULT true NOT NULL,
    pf_number character varying(30),
    conveyance numeric(10,2) DEFAULT 0 NOT NULL,
    medical numeric(10,2) DEFAULT 0 NOT NULL,
    other_earning numeric(10,2) DEFAULT 0 NOT NULL,
    sap_code character varying(30),
    profit_center_code character varying(30),
    profit_center_name character varying(100),
    cost_center_code character varying(30),
    cost_center_name character varying(100),
    resignation_date date,
    retirement_date date GENERATED ALWAYS AS (((dob + '60 years'::interval))::date) STORED,
    CONSTRAINT employees_category_check CHECK (((category)::text = ANY (ARRAY[('director'::character varying)::text, ('staff'::character varying)::text, ('worker'::character varying)::text]))),
    CONSTRAINT employees_gender_check CHECK (((gender)::text = ANY ((ARRAY['male'::character varying, 'female'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT employees_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'exited'::character varying])::text[])))
);


--
-- Name: entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entities (
    id character varying(10) NOT NULL,
    name character varying(100) NOT NULL,
    prefix character varying(4) NOT NULL,
    address text,
    gstn character varying(20),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: grades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grades (
    id integer NOT NULL,
    code character varying(10) NOT NULL,
    name character varying(50),
    entity_id character varying(10)
);


--
-- Name: grades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.grades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: grades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.grades_id_seq OWNED BY public.grades.id;


--
-- Name: helpdesk_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.helpdesk_tickets (
    id bigint NOT NULL,
    ticket_no character varying(15) NOT NULL,
    emp_code character varying(12) NOT NULL,
    category character varying(30) NOT NULL,
    subject character varying(200) NOT NULL,
    description text,
    status character varying(15) DEFAULT 'open'::character varying,
    assigned_to character varying(12),
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT helpdesk_tickets_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'in_progress'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[])))
);


--
-- Name: helpdesk_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.helpdesk_tickets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: helpdesk_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.helpdesk_tickets_id_seq OWNED BY public.helpdesk_tickets.id;


--
-- Name: leave_accrual_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_accrual_log (
    id integer NOT NULL,
    emp_code character varying(12) NOT NULL,
    leave_type character varying(5) NOT NULL,
    accrual_date date NOT NULL,
    days_credited numeric(5,2) NOT NULL,
    reason character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_accrual_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leave_accrual_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_accrual_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leave_accrual_log_id_seq OWNED BY public.leave_accrual_log.id;


--
-- Name: leave_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_balances (
    id integer NOT NULL,
    emp_code character varying(12) NOT NULL,
    leave_type character varying(5) NOT NULL,
    year smallint NOT NULL,
    entitlement numeric(5,2) DEFAULT 0,
    used numeric(5,2) DEFAULT 0,
    balance numeric(5,2) GENERATED ALWAYS AS ((entitlement - used)) STORED,
    carried_forward numeric(5,2) DEFAULT 0,
    accrued_ytd numeric(5,2) DEFAULT 0 NOT NULL,
    taken_ytd numeric(5,2) DEFAULT 0 NOT NULL,
    encashed_ytd numeric(5,2) DEFAULT 0 NOT NULL,
    CONSTRAINT leave_balances_leave_type_check CHECK (((leave_type)::text = ANY ((ARRAY['CL'::character varying, 'SL'::character varying, 'PL'::character varying])::text[])))
);


--
-- Name: leave_balances_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leave_balances_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_balances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leave_balances_id_seq OWNED BY public.leave_balances.id;


--
-- Name: leave_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_policies (
    id integer NOT NULL,
    entity_id character varying(10) NOT NULL,
    category character varying(10) DEFAULT 'staff'::character varying NOT NULL,
    leave_type character varying(5) NOT NULL,
    annual_quota numeric(5,2) NOT NULL,
    probation_accrual boolean DEFAULT false NOT NULL,
    carry_forward boolean DEFAULT false NOT NULL,
    encashment_allowed boolean DEFAULT false NOT NULL,
    min_balance_encashment integer DEFAULT 28 NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leave_policies_leave_type_check CHECK (((leave_type)::text = ANY ((ARRAY['CL'::character varying, 'SL'::character varying, 'PL'::character varying])::text[])))
);


--
-- Name: leave_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leave_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leave_policies_id_seq OWNED BY public.leave_policies.id;


--
-- Name: leave_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_policy (
    leave_type character varying(5) NOT NULL,
    annual_days numeric(5,2) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leave_policy_leave_type_check CHECK (((leave_type)::text = ANY ((ARRAY['CL'::character varying, 'SL'::character varying, 'PL'::character varying])::text[])))
);


--
-- Name: leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leave_requests (
    id bigint NOT NULL,
    emp_code character varying(12) NOT NULL,
    leave_type character varying(5) NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    days numeric(4,1) NOT NULL,
    reason text,
    status character varying(15) DEFAULT 'pending'::character varying,
    approved_by character varying(12),
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    entity_id character varying(10),
    actioned_by character varying(20),
    actioned_on timestamp with time zone,
    reject_note text,
    applied_on timestamp with time zone DEFAULT now(),
    CONSTRAINT leave_requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: leave_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leave_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leave_requests_id_seq OWNED BY public.leave_requests.id;


--
-- Name: loan_emi_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_emi_schedule (
    id integer NOT NULL,
    loan_id integer NOT NULL,
    emp_code character varying(12) NOT NULL,
    year smallint NOT NULL,
    month smallint NOT NULL,
    scheduled_emi numeric(10,2) NOT NULL,
    actual_emi numeric(10,2) NOT NULL,
    is_overridden boolean DEFAULT false NOT NULL,
    override_reason character varying(200),
    overridden_by character varying(12),
    applied boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loan_emi_schedule_month_check CHECK (((month >= 1) AND (month <= 12)))
);


--
-- Name: loan_emi_schedule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loan_emi_schedule_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loan_emi_schedule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loan_emi_schedule_id_seq OWNED BY public.loan_emi_schedule.id;


--
-- Name: loans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loans (
    id integer NOT NULL,
    emp_code character varying(12) NOT NULL,
    loan_type character varying(20) DEFAULT 'loan'::character varying NOT NULL,
    principal numeric(12,2) NOT NULL,
    emi numeric(10,2) NOT NULL,
    tenure_months integer NOT NULL,
    start_date date NOT NULL,
    end_date date,
    outstanding numeric(12,2) NOT NULL,
    status character varying(12) DEFAULT 'active'::character varying NOT NULL,
    remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(12),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loans_emi_check CHECK ((emi > (0)::numeric)),
    CONSTRAINT loans_loan_type_check CHECK (((loan_type)::text = ANY ((ARRAY['loan'::character varying, 'advance'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT loans_principal_check CHECK ((principal > (0)::numeric)),
    CONSTRAINT loans_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'paused'::character varying, 'closed'::character varying, 'written_off'::character varying])::text[]))),
    CONSTRAINT loans_tenure_months_check CHECK ((tenure_months > 0))
);


--
-- Name: loans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loans_id_seq OWNED BY public.loans.id;


--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id character varying(40) NOT NULL,
    name character varying(100) NOT NULL,
    city character varying(50) NOT NULL,
    state character varying(50) NOT NULL,
    entity_id character varying(10),
    lat numeric(10,7),
    lng numeric(10,7),
    radius_m integer DEFAULT 300,
    pt_state_code character varying(20) DEFAULT 'NIL'::character varying NOT NULL,
    gstn character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    phone character varying(20),
    CONSTRAINT locations_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: payroll_months; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_months (
    id bigint NOT NULL,
    emp_code character varying(12) NOT NULL,
    year smallint NOT NULL,
    month smallint NOT NULL,
    basic numeric(10,2) NOT NULL,
    hra numeric(10,2) DEFAULT 0 NOT NULL,
    spl numeric(10,2) DEFAULT 0 NOT NULL,
    cca numeric(10,2) DEFAULT 0 NOT NULL,
    gross numeric(10,2) NOT NULL,
    pf_emp numeric(8,2) DEFAULT 0 NOT NULL,
    pf_ern numeric(8,2) DEFAULT 0 NOT NULL,
    esic_emp numeric(8,2) DEFAULT 0 NOT NULL,
    esic_ern numeric(8,2) DEFAULT 0 NOT NULL,
    pt numeric(8,2) DEFAULT 0 NOT NULL,
    loan_emi numeric(8,2) DEFAULT 0 NOT NULL,
    other_deduction numeric(8,2) DEFAULT 0 NOT NULL,
    net_pay numeric(10,2) NOT NULL,
    total_days smallint DEFAULT 30 NOT NULL,
    pay_days smallint DEFAULT 30 NOT NULL,
    days_p smallint DEFAULT 0,
    days_a smallint DEFAULT 0,
    days_lwp smallint DEFAULT 0,
    days_wo smallint DEFAULT 0,
    days_cl smallint DEFAULT 0,
    days_pl smallint DEFAULT 0,
    days_sl smallint DEFAULT 0,
    days_h smallint DEFAULT 0,
    ot_hours numeric(5,2) DEFAULT 0,
    status character varying(15) DEFAULT 'draft'::character varying,
    salary_flag character varying(50),
    remarks text,
    generated_at timestamp with time zone DEFAULT now(),
    generated_by character varying(12),
    locked_at timestamp with time zone,
    leave_travel numeric(10,2) DEFAULT 0 NOT NULL,
    other_allowance numeric(10,2) DEFAULT 0 NOT NULL,
    period_start date,
    period_end date,
    total_working_days integer,
    conveyance numeric(10,2) DEFAULT 0 NOT NULL,
    medical numeric(10,2) DEFAULT 0 NOT NULL,
    other_earning numeric(10,2) DEFAULT 0 NOT NULL,
    salary_arrears numeric(10,2) DEFAULT 0 NOT NULL,
    income_tax numeric(10,2) DEFAULT 0 NOT NULL,
    lwf numeric(10,2) DEFAULT 0 NOT NULL,
    nps numeric(10,2) DEFAULT 0 NOT NULL,
    late_days integer DEFAULT 0 NOT NULL,
    absent_from_late numeric(5,2) DEFAULT 0 NOT NULL,
    ld numeric(10,2) DEFAULT 0 NOT NULL,
    ld_overridden boolean DEFAULT false NOT NULL,
    late_absent_overridden boolean DEFAULT false NOT NULL,
    total_deduction numeric(10,2) GENERATED ALWAYS AS ((((((pf_emp + esic_emp) + pt) + loan_emi) + other_deduction) + ld)) STORED,
    CONSTRAINT payroll_months_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT payroll_months_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'processed'::character varying, 'locked'::character varying])::text[])))
);


--
-- Name: payroll_months_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payroll_months_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_months_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payroll_months_id_seq OWNED BY public.payroll_months.id;


--
-- Name: public_holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_holidays (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    date date NOT NULL,
    location_id character varying(10),
    is_restricted boolean DEFAULT false NOT NULL,
    created_by character varying(20),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: public_holidays_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.public_holidays_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: public_holidays_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.public_holidays_id_seq OWNED BY public.public_holidays.id;


--
-- Name: salary_structures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salary_structures (
    id integer NOT NULL,
    emp_code character varying(20) NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    basic numeric(10,2) DEFAULT 0 NOT NULL,
    hra numeric(10,2) DEFAULT 0 NOT NULL,
    spl numeric(10,2) DEFAULT 0 NOT NULL,
    cca numeric(10,2) DEFAULT 0 NOT NULL,
    leave_travel numeric(10,2) DEFAULT 0 NOT NULL,
    other_allowance numeric(10,2) DEFAULT 0 NOT NULL,
    reason character varying(20) DEFAULT 'increment'::character varying NOT NULL,
    created_by character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    conveyance numeric(10,2) DEFAULT 0 NOT NULL,
    medical numeric(10,2) DEFAULT 0 NOT NULL,
    other_earning numeric(10,2) DEFAULT 0 NOT NULL,
    CONSTRAINT salary_structures_reason_check CHECK (((reason)::text = ANY ((ARRAY['initial'::character varying, 'increment'::character varying, 'correction'::character varying])::text[])))
);


--
-- Name: salary_structures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.salary_structures_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: salary_structures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.salary_structures_id_seq OWNED BY public.salary_structures.id;


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shifts (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    in_time time without time zone NOT NULL,
    out_time time without time zone NOT NULL,
    entity_id character varying(10)
);


--
-- Name: shifts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shifts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shifts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shifts_id_seq OWNED BY public.shifts.id;


--
-- Name: statutory_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statutory_config (
    id integer NOT NULL,
    state_code character varying(10) NOT NULL,
    gender character varying(10) DEFAULT 'all'::character varying,
    gross_from numeric(10,2) NOT NULL,
    gross_to numeric(10,2) NOT NULL,
    monthly_amount numeric(8,2) NOT NULL,
    feb_override numeric(8,2),
    annual_cap numeric(8,2) DEFAULT 2500,
    filing_freq character varying(20),
    due_day integer,
    penalty_desc text,
    effective_from date DEFAULT '2026-04-01'::date NOT NULL,
    effective_to date,
    CONSTRAINT statutory_config_gender_check CHECK (((gender)::text = ANY ((ARRAY['male'::character varying, 'female'::character varying, 'all'::character varying])::text[])))
);


--
-- Name: statutory_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.statutory_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: statutory_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.statutory_config_id_seq OWNED BY public.statutory_config.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    emp_code character varying(12) NOT NULL,
    password_hash text NOT NULL,
    role character varying(20) NOT NULL,
    is_first_login boolean DEFAULT true,
    is_active boolean DEFAULT true,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['super_admin'::character varying, 'entity_admin'::character varying, 'employee'::character varying])::text[])))
);


--
-- Name: v_employee_full; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_employee_full AS
 SELECT e.emp_code,
    e.legacy_code,
    e.sap_code,
    e.name,
    e.father_name,
    e.dob,
    e.gender,
    e.marital_status,
    e.mobile,
    e.email,
    e.doj,
    e.entity_id,
    ent.name AS entity_name,
    e.location_id,
    l.city AS location_city,
    l.state AS location_state,
    l.pt_state_code,
    d.name AS department,
    e.division,
    e.designation,
    g.code AS grade,
    e.reporting_mgr_code,
    s.name AS shift,
    e.ctc_annual,
    e.basic,
    e.hra,
    e.spl,
    e.cca,
    (((e.basic + e.hra) + e.spl) + e.cca) AS monthly_gross,
    e.pan,
    e.uan,
    e.esic_no,
    e.bank_name,
    e.ifsc,
    e.status
   FROM ((((((public.employees e
     LEFT JOIN public.entities ent ON (((ent.id)::text = (e.entity_id)::text)))
     LEFT JOIN public.locations l ON (((l.id)::text = (e.location_id)::text)))
     LEFT JOIN public.departments d ON ((d.id = e.department_id)))
     LEFT JOIN public.grades g ON ((g.id = e.grade_id)))
     LEFT JOIN public.shifts s ON ((s.id = e.shift_id)))
     LEFT JOIN public.users u ON (((u.emp_code)::text = (e.emp_code)::text)));


--
-- Name: v_payslip_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_payslip_summary AS
 SELECT pm.id,
    pm.emp_code,
    pm.year,
    pm.month,
    pm.basic,
    pm.hra,
    pm.spl,
    pm.cca,
    pm.gross,
    pm.pf_emp,
    pm.pf_ern,
    pm.esic_emp,
    pm.esic_ern,
    pm.pt,
    pm.loan_emi,
    pm.other_deduction,
    pm.ld,
    pm.total_deduction,
    pm.net_pay,
    pm.total_days,
    pm.pay_days,
    pm.days_p,
    pm.days_a,
    pm.days_lwp,
    pm.days_wo,
    pm.days_cl,
    pm.days_pl,
    pm.days_sl,
    pm.days_h,
    pm.late_days,
    pm.absent_from_late,
    pm.ot_hours,
    pm.status,
    pm.salary_flag,
    pm.remarks,
    pm.generated_at,
    pm.generated_by,
    pm.locked_at,
    e.name,
    e.designation,
    e.bank_name,
    e.ifsc,
    l.city AS location_city,
    ent.name AS entity_name,
    ent.id AS entity_id
   FROM (((public.payroll_months pm
     JOIN public.employees e ON (((e.emp_code)::text = (pm.emp_code)::text)))
     JOIN public.locations l ON (((l.id)::text = (e.location_id)::text)))
     JOIN public.entities ent ON (((ent.id)::text = (e.entity_id)::text)));


--
-- Name: assets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets ALTER COLUMN id SET DEFAULT nextval('public.assets_id_seq'::regclass);


--
-- Name: attendance_daily id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_daily ALTER COLUMN id SET DEFAULT nextval('public.attendance_daily_id_seq'::regclass);


--
-- Name: attendance_raw id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_raw ALTER COLUMN id SET DEFAULT nextval('public.attendance_raw_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: biometric_mapping id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_mapping ALTER COLUMN id SET DEFAULT nextval('public.biometric_mapping_id_seq'::regclass);


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments ALTER COLUMN id SET DEFAULT nextval('public.departments_id_seq'::regclass);


--
-- Name: documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents ALTER COLUMN id SET DEFAULT nextval('public.documents_id_seq'::regclass);


--
-- Name: employee_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_categories ALTER COLUMN id SET DEFAULT nextval('public.employee_categories_id_seq'::regclass);


--
-- Name: grades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grades ALTER COLUMN id SET DEFAULT nextval('public.grades_id_seq'::regclass);


--
-- Name: helpdesk_tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.helpdesk_tickets ALTER COLUMN id SET DEFAULT nextval('public.helpdesk_tickets_id_seq'::regclass);


--
-- Name: leave_accrual_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_accrual_log ALTER COLUMN id SET DEFAULT nextval('public.leave_accrual_log_id_seq'::regclass);


--
-- Name: leave_balances id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balances ALTER COLUMN id SET DEFAULT nextval('public.leave_balances_id_seq'::regclass);


--
-- Name: leave_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_policies ALTER COLUMN id SET DEFAULT nextval('public.leave_policies_id_seq'::regclass);


--
-- Name: leave_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests ALTER COLUMN id SET DEFAULT nextval('public.leave_requests_id_seq'::regclass);


--
-- Name: loan_emi_schedule id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_emi_schedule ALTER COLUMN id SET DEFAULT nextval('public.loan_emi_schedule_id_seq'::regclass);


--
-- Name: loans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans ALTER COLUMN id SET DEFAULT nextval('public.loans_id_seq'::regclass);


--
-- Name: payroll_months id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_months ALTER COLUMN id SET DEFAULT nextval('public.payroll_months_id_seq'::regclass);


--
-- Name: public_holidays id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_holidays ALTER COLUMN id SET DEFAULT nextval('public.public_holidays_id_seq'::regclass);


--
-- Name: salary_structures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salary_structures ALTER COLUMN id SET DEFAULT nextval('public.salary_structures_id_seq'::regclass);


--
-- Name: shifts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts ALTER COLUMN id SET DEFAULT nextval('public.shifts_id_seq'::regclass);


--
-- Name: statutory_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statutory_config ALTER COLUMN id SET DEFAULT nextval('public.statutory_config_id_seq'::regclass);


--
-- Name: assets assets_asset_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_asset_tag_key UNIQUE (asset_tag);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: attendance_daily attendance_daily_emp_code_att_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_daily
    ADD CONSTRAINT attendance_daily_emp_code_att_date_key UNIQUE (emp_code, att_date);


--
-- Name: attendance_daily attendance_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_daily
    ADD CONSTRAINT attendance_daily_pkey PRIMARY KEY (id);


--
-- Name: attendance_raw attendance_raw_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_raw
    ADD CONSTRAINT attendance_raw_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: biometric_mapping biometric_mapping_biometric_id_device_sn_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_mapping
    ADD CONSTRAINT biometric_mapping_biometric_id_device_sn_key UNIQUE (biometric_id, device_sn);


--
-- Name: biometric_mapping biometric_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_mapping
    ADD CONSTRAINT biometric_mapping_pkey PRIMARY KEY (id);


--
-- Name: departments departments_name_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_name_entity_id_key UNIQUE (name, entity_id);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: employee_categories employee_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_categories
    ADD CONSTRAINT employee_categories_name_key UNIQUE (name);


--
-- Name: employee_categories employee_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_categories
    ADD CONSTRAINT employee_categories_pkey PRIMARY KEY (id);


--
-- Name: employees employees_legacy_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_legacy_code_key UNIQUE (legacy_code);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (emp_code);


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);


--
-- Name: entities entities_prefix_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_prefix_key UNIQUE (prefix);


--
-- Name: grades grades_code_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grades
    ADD CONSTRAINT grades_code_entity_id_key UNIQUE (code, entity_id);


--
-- Name: grades grades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grades
    ADD CONSTRAINT grades_pkey PRIMARY KEY (id);


--
-- Name: helpdesk_tickets helpdesk_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.helpdesk_tickets
    ADD CONSTRAINT helpdesk_tickets_pkey PRIMARY KEY (id);


--
-- Name: helpdesk_tickets helpdesk_tickets_ticket_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.helpdesk_tickets
    ADD CONSTRAINT helpdesk_tickets_ticket_no_key UNIQUE (ticket_no);


--
-- Name: leave_accrual_log leave_accrual_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_accrual_log
    ADD CONSTRAINT leave_accrual_log_pkey PRIMARY KEY (id);


--
-- Name: leave_balances leave_balances_emp_code_leave_type_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balances
    ADD CONSTRAINT leave_balances_emp_code_leave_type_year_key UNIQUE (emp_code, leave_type, year);


--
-- Name: leave_balances leave_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balances
    ADD CONSTRAINT leave_balances_pkey PRIMARY KEY (id);


--
-- Name: leave_policies leave_policies_entity_id_category_leave_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_policies
    ADD CONSTRAINT leave_policies_entity_id_category_leave_type_key UNIQUE (entity_id, category, leave_type);


--
-- Name: leave_policies leave_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_policies
    ADD CONSTRAINT leave_policies_pkey PRIMARY KEY (id);


--
-- Name: leave_policy leave_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_policy
    ADD CONSTRAINT leave_policy_pkey PRIMARY KEY (leave_type);


--
-- Name: leave_requests leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (id);


--
-- Name: loan_emi_schedule loan_emi_schedule_loan_id_year_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_emi_schedule
    ADD CONSTRAINT loan_emi_schedule_loan_id_year_month_key UNIQUE (loan_id, year, month);


--
-- Name: loan_emi_schedule loan_emi_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_emi_schedule
    ADD CONSTRAINT loan_emi_schedule_pkey PRIMARY KEY (id);


--
-- Name: loans loans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_pkey PRIMARY KEY (id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: payroll_months payroll_months_emp_code_year_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_months
    ADD CONSTRAINT payroll_months_emp_code_year_month_key UNIQUE (emp_code, year, month);


--
-- Name: payroll_months payroll_months_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_months
    ADD CONSTRAINT payroll_months_pkey PRIMARY KEY (id);


--
-- Name: public_holidays public_holidays_date_location_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_holidays
    ADD CONSTRAINT public_holidays_date_location_id_key UNIQUE (date, location_id);


--
-- Name: public_holidays public_holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_holidays
    ADD CONSTRAINT public_holidays_pkey PRIMARY KEY (id);


--
-- Name: salary_structures salary_structures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salary_structures
    ADD CONSTRAINT salary_structures_pkey PRIMARY KEY (id);


--
-- Name: shifts shifts_name_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_name_entity_id_key UNIQUE (name, entity_id);


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);


--
-- Name: statutory_config statutory_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statutory_config
    ADD CONSTRAINT statutory_config_pkey PRIMARY KEY (id);


--
-- Name: statutory_config statutory_config_state_code_gender_gross_from_effective_fro_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statutory_config
    ADD CONSTRAINT statutory_config_state_code_gender_gross_from_effective_fro_key UNIQUE (state_code, gender, gross_from, effective_from);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (emp_code);


--
-- Name: employees_sap_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employees_sap_code_key ON public.employees USING btree (sap_code) WHERE (sap_code IS NOT NULL);


--
-- Name: idx_att_daily_emp_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_att_daily_emp_date ON public.attendance_daily USING btree (emp_code, att_date);


--
-- Name: idx_att_raw_emp_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_att_raw_emp_time ON public.attendance_raw USING btree (emp_code, punch_time);


--
-- Name: idx_audit_tbl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_tbl ON public.audit_log USING btree (table_name);


--
-- Name: idx_audit_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_ts ON public.audit_log USING btree (ts DESC);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.audit_log USING btree (user_code);


--
-- Name: idx_docs_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_docs_emp ON public.documents USING btree (emp_code);


--
-- Name: idx_emp_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_dept ON public.employees USING btree (department_id);


--
-- Name: idx_emp_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_entity ON public.employees USING btree (entity_id);


--
-- Name: idx_emp_legacy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_legacy ON public.employees USING btree (legacy_code);


--
-- Name: idx_emp_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_location ON public.employees USING btree (location_id);


--
-- Name: idx_emp_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_status ON public.employees USING btree (status);


--
-- Name: idx_loans_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_emp ON public.loans USING btree (emp_code);


--
-- Name: idx_loans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_status ON public.loans USING btree (status);


--
-- Name: idx_loansched_emp_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loansched_emp_period ON public.loan_emi_schedule USING btree (emp_code, year, month);


--
-- Name: idx_payroll_emp_ym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_emp_ym ON public.payroll_months USING btree (emp_code, year, month);


--
-- Name: idx_payroll_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_status ON public.payroll_months USING btree (status);


--
-- Name: idx_ph_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ph_date ON public.public_holidays USING btree (date);


--
-- Name: idx_ph_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ph_location ON public.public_holidays USING btree (location_id);


--
-- Name: idx_salstruct_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salstruct_dates ON public.salary_structures USING btree (effective_from, effective_to);


--
-- Name: idx_salstruct_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salstruct_emp ON public.salary_structures USING btree (emp_code);


--
-- Name: uq_salstruct_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_salstruct_active ON public.salary_structures USING btree (emp_code) WHERE (effective_to IS NULL);


--
-- Name: employees trg_employees_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: loans trg_loans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_loans_updated_at BEFORE UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: employees trg_protect_company_figures; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_company_figures BEFORE DELETE OR UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.protect_company_figures();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: assets assets_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.employees(emp_code);


--
-- Name: assets assets_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id);


--
-- Name: attendance_daily attendance_daily_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_daily
    ADD CONSTRAINT attendance_daily_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: attendance_daily attendance_daily_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_daily
    ADD CONSTRAINT attendance_daily_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: attendance_daily attendance_daily_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_daily
    ADD CONSTRAINT attendance_daily_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: attendance_raw attendance_raw_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_raw
    ADD CONSTRAINT attendance_raw_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: biometric_mapping biometric_mapping_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_mapping
    ADD CONSTRAINT biometric_mapping_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: biometric_mapping biometric_mapping_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_mapping
    ADD CONSTRAINT biometric_mapping_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: departments departments_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id);


--
-- Name: documents documents_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.employees(emp_code);


--
-- Name: employees employees_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: employees employees_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id);


--
-- Name: employees employees_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(id);


--
-- Name: employees employees_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: employees employees_reporting_mgr_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_reporting_mgr_code_fkey FOREIGN KEY (reporting_mgr_code) REFERENCES public.employees(emp_code) DEFERRABLE;


--
-- Name: employees employees_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: grades grades_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grades
    ADD CONSTRAINT grades_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id);


--
-- Name: helpdesk_tickets helpdesk_tickets_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.helpdesk_tickets
    ADD CONSTRAINT helpdesk_tickets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.employees(emp_code);


--
-- Name: helpdesk_tickets helpdesk_tickets_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.helpdesk_tickets
    ADD CONSTRAINT helpdesk_tickets_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: leave_accrual_log leave_accrual_log_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_accrual_log
    ADD CONSTRAINT leave_accrual_log_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: leave_balances leave_balances_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_balances
    ADD CONSTRAINT leave_balances_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: leave_policies leave_policies_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_policies
    ADD CONSTRAINT leave_policies_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id);


--
-- Name: leave_requests leave_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.employees(emp_code);


--
-- Name: leave_requests leave_requests_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leave_requests
    ADD CONSTRAINT leave_requests_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: loan_emi_schedule loan_emi_schedule_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_emi_schedule
    ADD CONSTRAINT loan_emi_schedule_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: loan_emi_schedule loan_emi_schedule_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_emi_schedule
    ADD CONSTRAINT loan_emi_schedule_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE CASCADE;


--
-- Name: loans loans_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: locations locations_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id);


--
-- Name: payroll_months payroll_months_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_months
    ADD CONSTRAINT payroll_months_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: salary_structures salary_structures_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salary_structures
    ADD CONSTRAINT salary_structures_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- Name: shifts shifts_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id);


--
-- Name: users users_emp_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_emp_code_fkey FOREIGN KEY (emp_code) REFERENCES public.employees(emp_code);


--
-- PostgreSQL database dump complete
--

\unrestrict QDtJeKLEMJ6FCvuJU8f0TBNxSYs6qafNBNIGAY01IkrUmpwir3AtobfbpX6H26X

