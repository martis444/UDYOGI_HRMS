-- 018_merge_other_earning.sql
-- Merge the legacy record-only `other_allowance` salary field into the paid
-- `other_earning` on the employee + salary-structure records.
--
-- Context: "Other Allowance" and "Other Earning" were two confusing fixed salary
-- fields. They are now one field — "Other Earning" — which IS paid (added to net,
-- excluded from the PF/ESIC/PT statutory base). This backfill folds any existing
-- other_allowance value into other_earning and zeroes the old column.
--
-- The payroll engine also folds other_allowance into other_earning at compute
-- time, so payroll is correct even before this runs; this just makes the stored
-- salary record show the single merged value and stops the old column drifting.
--
-- NOT touched: payroll_months.other_allowance — that is the separate per-month
-- one-off reward (entered via the attendance CSV) and remains its own bucket
-- (only its display label changed to "Other Earning").
--
-- Idempotent: re-running only folds rows that still have other_allowance > 0.

BEGIN;

UPDATE employees
   SET other_earning   = COALESCE(other_earning, 0) + other_allowance,
       other_allowance = 0
 WHERE other_allowance IS NOT NULL
   AND other_allowance > 0;

UPDATE salary_structures
   SET other_earning   = COALESCE(other_earning, 0) + other_allowance,
       other_allowance = 0
 WHERE other_allowance IS NOT NULL
   AND other_allowance > 0;

COMMIT;
