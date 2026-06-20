-- 010_leave_buckets.sql — Session 15.3
-- Retire EL (Earned Leave). The leave model is now exactly CL / SL / PL with a flat
-- annual grant (see leave_engine). Any existing EL data is folded into PL so no
-- balance is lost, then EL is removed from every constraint.
--
--   leave_balances : fold EL.entitlement/used into PL per (emp, year), drop EL rows,
--                    tighten the leave_type CHECK to {CL, SL, PL}.
--   leave_policies : CHECK is already {CL,SL,PL}; delete any stray non-{CL,SL,PL} rows.
--   attendance_daily: att_status loses 'el', gains 'pl' (leave days reflect as cl/sl/pl).
--   payroll_months : rename the vestigial days_el column to days_pl (PL attendance count).
--                    v_payslip_summary references it, so drop+recreate the view.

BEGIN;

-- 1a. Fold EL into an existing PL row for the same (emp_code, year).
UPDATE leave_balances pl
SET entitlement = COALESCE(pl.entitlement, 0) + COALESCE(el.entitlement, 0),
    used        = COALESCE(pl.used, 0)        + COALESCE(el.used, 0)
FROM leave_balances el
WHERE el.leave_type = 'EL' AND pl.leave_type = 'PL'
  AND pl.emp_code = el.emp_code AND pl.year = el.year;

-- 1b. EL rows with no PL counterpart simply become PL.
UPDATE leave_balances el
SET leave_type = 'PL'
WHERE el.leave_type = 'EL'
  AND NOT EXISTS (
    SELECT 1 FROM leave_balances pl
    WHERE pl.leave_type = 'PL' AND pl.emp_code = el.emp_code AND pl.year = el.year
  );

-- 1c. Delete the EL rows that were folded into an existing PL row.
DELETE FROM leave_balances WHERE leave_type = 'EL';

-- 2. Tighten leave_balances leave_type to {CL, SL, PL}.
ALTER TABLE leave_balances DROP CONSTRAINT IF EXISTS leave_balances_leave_type_check;
ALTER TABLE leave_balances ADD CONSTRAINT leave_balances_leave_type_check
  CHECK (leave_type IN ('CL', 'SL', 'PL'));

-- 3. leave_policies: CHECK is already {CL,SL,PL}; remove any out-of-set rows just in case.
DELETE FROM leave_policies WHERE leave_type NOT IN ('CL', 'SL', 'PL');

-- 4. attendance_daily att_status: migrate any 'el' rows to 'pl', swap the CHECK.
UPDATE attendance_daily SET att_status = 'pl' WHERE att_status = 'el';
ALTER TABLE attendance_daily DROP CONSTRAINT IF EXISTS attendance_daily_att_status_check;
ALTER TABLE attendance_daily ADD CONSTRAINT attendance_daily_att_status_check
  CHECK (att_status IN ('present','absent','halfday','late','lwp','cl','pl','sl','holiday','wo'));

-- 5. payroll_months.days_el -> days_pl (drop dependent view first, recreate after).
DROP VIEW IF EXISTS public.v_payslip_summary;
ALTER TABLE payroll_months RENAME COLUMN days_el TO days_pl;

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
    pm.days_pl,
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
VALUES (NULL, 'RETIRE_EL', 'leave_balances', 'migration_010',
        '{"note": "EL folded into PL; EL removed from leave_balances/attendance_daily CHECKs; payroll_months.days_el renamed days_pl. Leave model is now CL/SL/PL."}'::jsonb);

COMMIT;
