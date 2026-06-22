-- 013_widen_mobile.sql — allow multiple mobile numbers per employee
--
-- Employees can have several contact numbers, stored slash-separated
-- (e.g. "9876543210/9123456780/9000000001"). The old varchar(15) only fit a
-- single number; widen to 64 so a handful of numbers fit. No data is changed.

BEGIN;

ALTER TABLE public.employees
    ALTER COLUMN mobile TYPE character varying(64);

COMMIT;
