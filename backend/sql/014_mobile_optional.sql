-- 014_mobile_optional.sql — allow employees with no mobile number
--
-- Some employees (e.g. directors) have no listed contact number. The NOT NULL
-- constraint forced bulk imports to skip them. Drop it so a blank mobile is
-- allowed; format validation still applies when a number IS provided.

BEGIN;

ALTER TABLE public.employees
    ALTER COLUMN mobile DROP NOT NULL;

COMMIT;
