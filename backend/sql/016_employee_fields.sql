-- 016_employee_fields.sql
-- Session 18: employee field changes requested by client.
--   ADD:    profit/cost center (code+name), resignation_date, retirement_date (auto = DOB+60y),
--           'director' as a third category.
--   REMOVE: present_city/state/pin, perm_city/state/pin, bank_branch (full address text stays).
--   other_allowance is repurposed to RECORD-ONLY (no schema change here; the engine/payslip stop
--           counting it — code change, see payroll_engine.py / payslip.py / templates).
--
-- Apply on the live server via psql (git pull never touches the DB):
--   PGPASSWORD=... psql -U postgres -h localhost -d udyogi_hrms -f backend/sql/016_employee_fields.sql

BEGIN;

-- 1. Category: allow 'director' (was staff/worker only). varchar(10) already fits 'director'.
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_category_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_category_check
    CHECK (((category)::text = ANY ((ARRAY['director'::character varying, 'staff'::character varying, 'worker'::character varying])::text[])));

ALTER TABLE public.employee_categories DROP CONSTRAINT IF EXISTS employee_categories_name_check;
ALTER TABLE public.employee_categories ADD CONSTRAINT employee_categories_name_check
    CHECK (((name)::text = ANY ((ARRAY['director'::character varying, 'staff'::character varying, 'worker'::character varying])::text[])));

-- 2. Profit/Cost center + resignation date (all nullable, manual).
ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS profit_center_code character varying(30),
    ADD COLUMN IF NOT EXISTS profit_center_name character varying(100),
    ADD COLUMN IF NOT EXISTS cost_center_code   character varying(30),
    ADD COLUMN IF NOT EXISTS cost_center_name   character varying(100),
    ADD COLUMN IF NOT EXISTS resignation_date   date;

-- 3. Retirement date: always derived from DOB + 60 years (read-only generated column).
--    NULL when dob is NULL. Auto-corrects if DOB is fixed.
ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS retirement_date date
    GENERATED ALWAYS AS (((dob + '60 years'::interval))::date) STORED;

-- 4. Remove address breakdown + bank_branch.
--    v_employee_full depends on present_city/present_state, so drop it first, then recreate
--    without those two columns (same drop-recreate pattern used for the mobile widen in 013).
DROP VIEW IF EXISTS public.v_employee_full;

ALTER TABLE public.employees
    DROP COLUMN IF EXISTS present_city,
    DROP COLUMN IF EXISTS present_state,
    DROP COLUMN IF EXISTS present_pin,
    DROP COLUMN IF EXISTS perm_city,
    DROP COLUMN IF EXISTS perm_state,
    DROP COLUMN IF EXISTS perm_pin,
    DROP COLUMN IF EXISTS bank_branch;

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

COMMIT;
