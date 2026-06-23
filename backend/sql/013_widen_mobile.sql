-- 013_widen_mobile.sql — allow multiple mobile numbers per employee
--
-- Employees can have several contact numbers, stored slash-separated
-- (e.g. "9876543210/9123456780/9000000001"). The old varchar(15) only fit a
-- single number; widen to 64 so a handful of numbers fit. No data is changed.
--
-- The v_employee_full view reads employees.mobile, and Postgres refuses to
-- ALTER a column a view depends on, so we drop the view, widen the column,
-- then recreate the view exactly as it was.

BEGIN;

DROP VIEW IF EXISTS public.v_employee_full;

ALTER TABLE public.employees
    ALTER COLUMN mobile TYPE character varying(64);

CREATE VIEW public.v_employee_full AS
 SELECT e.emp_code,
    e.legacy_code,
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
