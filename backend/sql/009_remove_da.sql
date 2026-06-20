-- 009_remove_da.sql — Session 15.1
-- Fold DA into basic everywhere, then drop the `da` column from the 3 salary
-- tables. Nobody's pay changes: gross was basic+hra+da+spl+cca+leave_travel and
-- PF base was basic+da; after folding da into basic, gross = basic+hra+spl+cca+
-- leave_travel and PF base = basic give identical numbers.
--
--   golden UM000001: basic 5542 + da 1000 -> basic 6542, gross stays 9349,
--   PF stays min(round(0.12*6542),1800)=785.
--
-- payroll_months.da is a frozen historical snapshot — we do NOT rewrite past
-- rows (their stored gross/net are already correct); we only drop the column.
-- total_deduction is GENERATED on (pf_emp+esic_emp+pt+loan_emi+other_deduction)
-- and never referenced da, so no generated-column rebuild is needed.
--
-- Two views (v_employee_full, v_payslip_summary) reference da, so they are
-- dropped first and recreated without it (same pattern as 005_locations_gstn).

BEGIN;

-- 0. Drop the views that reference da (recreated at the end, da-free).
DROP VIEW IF EXISTS public.v_employee_full;
DROP VIEW IF EXISTS public.v_payslip_summary;

-- 1. Fold da into basic on every salary_structures row.
UPDATE salary_structures SET basic = COALESCE(basic, 0) + COALESCE(da, 0);

-- 2. Fold da into basic on the synced employees cache.
UPDATE employees SET basic = COALESCE(basic, 0) + COALESCE(da, 0);

-- 3. payroll_months: historical snapshots left as-is (only the column is dropped).

-- 4. Drop the da columns.
ALTER TABLE employees         DROP COLUMN da;
ALTER TABLE salary_structures DROP COLUMN da;
ALTER TABLE payroll_months    DROP COLUMN da;

-- 5. Recreate the views without da (monthly_gross drops da too).
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
    pm.total_deduction,
    pm.net_pay,
    pm.total_days,
    pm.pay_days,
    pm.days_p,
    pm.days_a,
    pm.days_lwp,
    pm.days_wo,
    pm.days_cl,
    pm.days_el,
    pm.days_sl,
    pm.days_h,
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

-- 6. Audit.
INSERT INTO audit_log (user_code, action, table_name, record_id, new_values)
VALUES (NULL, 'REMOVE_DA', 'salary_structures', 'migration_009',
        '{"note": "DA folded into basic on employees + salary_structures; da column dropped from employees, salary_structures, payroll_months. No pay changed."}'::jsonb);

COMMIT;
