-- 015_sap_code.sql — add SAP employee code for the SAP integration
--
-- sap_code is an employee identifier (their code in SAP). It lives only on the
-- employees table; every other place reads it by joining. Many employees will
-- be blank during onboarding, so it's nullable but UNIQUE when present (Postgres
-- treats NULLs as distinct, so multiple blanks are fine).
--
-- The v_employee_full view reads from employees, and Postgres refuses to add a
-- column other views/rules depend on without a drop, so we drop the view, add
-- the column, recreate the view (now exposing sap_code), and add the index.

BEGIN;

DROP VIEW IF EXISTS public.v_employee_full;

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS sap_code character varying(30);

CREATE UNIQUE INDEX IF NOT EXISTS employees_sap_code_key
    ON public.employees (sap_code)
    WHERE sap_code IS NOT NULL;

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
    e.present_city,
    e.present_state,
    e.status,
    u.role
   FROM ((((((public.employees e
     LEFT JOIN public.entities ent ON (((ent.id)::text = (e.entity_id)::text)))
     LEFT JOIN public.locations l ON (((l.id)::text = (e.location_id)::text)))
     LEFT JOIN public.departments d ON ((d.id = e.department_id)))
     LEFT JOIN public.grades g ON ((g.id = e.grade_id)))
     LEFT JOIN public.shifts s ON ((s.id = e.shift_id)))
     LEFT JOIN public.users u ON (((u.emp_code)::text = (e.emp_code)::text)));

COMMIT;
