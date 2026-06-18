-- Session 13.15 — Salary structure history + effective-dated increments
-- salary_structures becomes the source of truth; employees salary columns are a
-- synced cache of the currently-active structure. Increments align to the 26th
-- payroll-cycle boundary (no mid-period proration).

-- A1. Table -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salary_structures (
  id              SERIAL PRIMARY KEY,
  emp_code        VARCHAR(20) NOT NULL REFERENCES employees(emp_code),
  effective_from  DATE NOT NULL,
  effective_to    DATE,                 -- NULL = currently active
  basic           NUMERIC(10,2) NOT NULL DEFAULT 0,
  hra             NUMERIC(10,2) NOT NULL DEFAULT 0,
  da              NUMERIC(10,2) NOT NULL DEFAULT 0,
  spl             NUMERIC(10,2) NOT NULL DEFAULT 0,
  cca             NUMERIC(10,2) NOT NULL DEFAULT 0,
  leave_travel    NUMERIC(10,2) NOT NULL DEFAULT 0,
  other_allowance NUMERIC(10,2) NOT NULL DEFAULT 0,
  reason          VARCHAR(20) NOT NULL DEFAULT 'increment'
                  CHECK (reason IN ('initial','increment','correction')),
  created_by      VARCHAR(20),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salstruct_emp   ON salary_structures(emp_code);
CREATE INDEX IF NOT EXISTS idx_salstruct_dates ON salary_structures(effective_from, effective_to);

-- Prevent overlapping active rows per employee (only one NULL effective_to)
CREATE UNIQUE INDEX IF NOT EXISTS uq_salstruct_active
  ON salary_structures(emp_code) WHERE effective_to IS NULL;

-- A2. Backfill --------------------------------------------------------------
-- Join-date column on this schema is `doj` (not date_of_joining).
INSERT INTO salary_structures
  (emp_code, effective_from, effective_to, basic, hra, da, spl, cca,
   leave_travel, other_allowance, reason, created_by)
SELECT
  emp_code,
  COALESCE(doj, DATE '2020-01-01'),
  NULL,
  COALESCE(basic,0), COALESCE(hra,0), COALESCE(da,0), COALESCE(spl,0), COALESCE(cca,0),
  COALESCE(leave_travel,0), COALESCE(other_allowance,0),
  'initial', 'system_backfill'
FROM employees
WHERE NOT EXISTS (
  SELECT 1 FROM salary_structures s WHERE s.emp_code = employees.emp_code
);
