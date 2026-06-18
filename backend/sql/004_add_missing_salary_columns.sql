-- Add the salary columns present in the client Excel master but missing from the DB.
-- SCHEMA ONLY: columns are created with safe defaults; payroll engine / models /
-- statutory treatment are NOT wired yet (deferred until treatment decisions land).
-- Held intentionally: payroll_series + salary_att (semantics to be confirmed).

-- Recurring earnings → master (employees cache + salary_structures) + monthly snapshot
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS conveyance    numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medical       numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_earning numeric(10,2) NOT NULL DEFAULT 0;

ALTER TABLE salary_structures
  ADD COLUMN IF NOT EXISTS conveyance    numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medical       numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_earning numeric(10,2) NOT NULL DEFAULT 0;

-- Per-month figures: one-off arrears (earning) + new deductions
ALTER TABLE payroll_months
  ADD COLUMN IF NOT EXISTS conveyance     numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medical        numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_earning  numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salary_arrears numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS income_tax     numeric(10,2) NOT NULL DEFAULT 0,   -- ITAX / TDS
  ADD COLUMN IF NOT EXISTS lwf            numeric(10,2) NOT NULL DEFAULT 0,   -- LAB WEL (labour welfare fund)
  ADD COLUMN IF NOT EXISTS nps            numeric(10,2) NOT NULL DEFAULT 0;   -- employee NPS

-- NOTE: payroll_months.total_deduction is GENERATED ALWAYS AS
--   (pf_emp + esic_emp + pt + loan_emi + other_deduction).
-- income_tax / lwf / nps are NOT yet included in that expression — they are
-- stored only. Reworking the generated column happens when the engine is wired.
