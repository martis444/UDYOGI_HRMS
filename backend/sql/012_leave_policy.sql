-- 012_leave_policy.sql — Session 15.7
-- Single source of truth for leave entitlement policy + clean the stale test `used`.
--
-- entitlement is no longer stored by hand — it is DERIVED (years_of_service ×
-- policy) and auto-materialized by resolve_leave_balance (leave_engine). This table
-- holds the ONE editable policy set (CL/SL/PL) for all entities; changing a row
-- changes every employee's TB on the next read.

BEGIN;

CREATE TABLE IF NOT EXISTS leave_policy (
    leave_type   varchar(5) PRIMARY KEY CHECK (leave_type IN ('CL', 'SL', 'PL')),
    annual_days  numeric(5,2) NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO leave_policy (leave_type, annual_days) VALUES
    ('CL', 10), ('SL', 7), ('PL', 14)
ON CONFLICT (leave_type) DO NOTHING;

-- Part D: the live leave_balances `used`/`taken_ytd` are bogus leftovers from
-- earlier test manipulation (seeded directors/figures + UM000001/UP000001 have NO
-- real approved-leave history in this DB). Reset them to 0 so available = full
-- allotment. entitlement is left for the materializer to write-through.
UPDATE leave_balances
SET used = 0, taken_ytd = 0, carried_forward = 0, accrued_ytd = 0, encashed_ytd = 0;

INSERT INTO audit_log (user_code, action, table_name, record_id, new_values)
VALUES (NULL, 'LEAVE_POLICY_INIT', 'leave_policy', 'migration_012',
        '{"note": "leave_policy seeded CL10/SL7/PL14; entitlement now derived+auto-materialized (revises 15.4); reset bogus test used/taken_ytd to 0."}'::jsonb);

COMMIT;
