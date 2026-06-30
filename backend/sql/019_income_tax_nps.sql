-- 019_income_tax_nps.sql — Session 22 (salary-sheet expansion)
--
-- Activate INCOME TAX (manual) and NATIONAL PENSION / NPS (manual) as real monthly
-- deductions. The columns income_tax / nps / medical already exist on payroll_months
-- (added schema-only in 13.20, never wired). This migration only rebuilds the
-- GENERATED total_deduction to fold income_tax + nps into it; medical is an EARNING
-- (added to gross by the engine) and needs no deduction change.
--
-- v_payslip_summary depends on total_deduction, so it is dropped first and recreated
-- (now also exposing medical / income_tax / nps). Mirrors the 011 pattern (ld).
--
-- No new columns: income_tax/nps/medical are already numeric(10,2) DEFAULT 0 NOT NULL.

BEGIN;

-- 0. Drop the dependent view (references total_deduction).
DROP VIEW IF EXISTS public.v_payslip_summary;

-- 0b. Ensure the columns exist. They were added schema-only in 13.20 on the LOCAL DB,
-- but the live DB only got numbered migrations — so guard with IF NOT EXISTS (no-op
-- where they already exist). The generated total_deduction below references them.
ALTER TABLE payroll_months   ADD COLUMN IF NOT EXISTS medical    numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE payroll_months   ADD COLUMN IF NOT EXISTS income_tax numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE payroll_months   ADD COLUMN IF NOT EXISTS nps        numeric(10,2) DEFAULT 0 NOT NULL;
-- salary_structures.medical: newly mapped by the SQLAlchemy model this session
-- (engine reads struct.medical), so it MUST exist or every payroll compute breaks.
ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS medical   numeric(10,2) DEFAULT 0 NOT NULL;

-- 1. Rebuild total_deduction to include income_tax + nps (drop + re-add generated col).
ALTER TABLE payroll_months DROP COLUMN total_deduction;
ALTER TABLE payroll_months ADD COLUMN total_deduction numeric(10,2)
    GENERATED ALWAYS AS (
        ((((((pf_emp + esic_emp) + pt) + loan_emi) + other_deduction) + ld)
         + income_tax + nps)
    ) STORED;

-- 2. Recreate v_payslip_summary (unchanged columns + medical/income_tax/nps).
CREATE VIEW public.v_payslip_summary AS
 SELECT pm.id,
    pm.emp_code,
    pm.year,
    pm.month,
    pm.basic,
    pm.hra,
    pm.spl,
    pm.cca,
    pm.medical,
    pm.gross,
    pm.pf_emp,
    pm.pf_ern,
    pm.esic_emp,
    pm.esic_ern,
    pm.pt,
    pm.loan_emi,
    pm.other_deduction,
    pm.ld,
    pm.income_tax,
    pm.nps,
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

-- 3. Audit.
INSERT INTO audit_log (user_code, action, table_name, record_id, new_values)
VALUES (NULL, 'WIRE_INCOME_TAX_NPS', 'payroll_months', 'migration_019',
        '{"note": "total_deduction generated column now includes income_tax + nps; v_payslip_summary exposes medical/income_tax/nps."}'::jsonb);

COMMIT;
