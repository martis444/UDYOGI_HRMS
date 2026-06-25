-- 017_confirmation_date.sql
-- Session 18: leave rule change — CL/SL no longer carry forward; they accrue
-- monthly (annual/12) within the financial year (1 Apr–31 Mar), starting AFTER
-- the employee is confirmed. This needs an explicit, HR-set date of confirmation
-- (distinct from the auto-computed probation_end_date).
--
-- Leave balances themselves are DERIVED (15.7), so there is nothing to "reset" in
-- the DB — the engine scopes CL/SL to the current FY on read. Only this one column
-- is added. PL is unchanged (cumulative, carries forward, granted after 1y DOJ).
--
-- Apply on the live server via psql AFTER 016:
--   PGPASSWORD=... psql -U postgres -h localhost -d udyogi_hrms -f backend/sql/017_confirmation_date.sql

BEGIN;

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS confirmation_date date;

COMMIT;
