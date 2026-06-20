-- 011_late_ld.sql — Session 15.4
-- Late-coming penalty + Late Deduction (LD).
--
-- Every LATE_DAYS_PER_ABSENT (3) 'late' days in a pay period = 1 absent-equivalent,
-- covered first from the highest CL/SL/PL leave balance; whatever leave can't cover
-- is charged as LD = uncovered_days * monthly_gross / 30.
--
-- New payroll_months columns track the late maths + admin overrides, and the
-- GENERATED total_deduction is rebuilt to include ld. v_payslip_summary depends on
-- total_deduction, so it is dropped first and recreated.

BEGIN;

-- 0. Drop the dependent view (references total_deduction).
DROP VIEW IF EXISTS public.v_payslip_summary;

-- 1. New columns.
ALTER TABLE payroll_months ADD COLUMN IF NOT EXISTS late_days integer NOT NULL DEFAULT 0;
ALTER TABLE payroll_months ADD COLUMN IF NOT EXISTS absent_from_late numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_months ADD COLUMN IF NOT EXISTS ld numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_months ADD COLUMN IF NOT EXISTS ld_overridden boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_months ADD COLUMN IF NOT EXISTS late_absent_overridden boolean NOT NULL DEFAULT false;

-- 2. Rebuild total_deduction to include ld (drop + re-add the generated column).
ALTER TABLE payroll_months DROP COLUMN total_deduction;
ALTER TABLE payroll_months ADD COLUMN total_deduction numeric(10,2)
    GENERATED ALWAYS AS (((((pf_emp + esic_emp) + pt) + loan_emi) + other_deduction) + ld) STORED;

-- 3. Recreate v_payslip_summary (unchanged columns; total_deduction now includes ld).
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

-- 4. Audit.
INSERT INTO audit_log (user_code, action, table_name, record_id, new_values)
VALUES (NULL, 'ADD_LATE_LD', 'payroll_months', 'migration_011',
        '{"note": "Added late_days/absent_from_late/ld + override flags; total_deduction generated column now includes ld."}'::jsonb);

COMMIT;
