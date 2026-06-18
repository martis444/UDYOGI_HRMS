-- SESSION 14.3 — Loan / advance module.
-- payroll_months.loan_emi already exists and feeds the GENERATED total_deduction.
-- This adds the source loans + a per-month editable EMI ledger.
-- (Filename 008_: 006=seed_prominent_figures, 007=protect_figures.)

CREATE TABLE IF NOT EXISTS loans (
  id              SERIAL PRIMARY KEY,
  emp_code        varchar(12) NOT NULL REFERENCES employees(emp_code),
  loan_type       varchar(20) NOT NULL DEFAULT 'loan'
                    CHECK (loan_type IN ('loan','advance','other')),
  principal       numeric(12,2) NOT NULL CHECK (principal > 0),
  emi             numeric(10,2) NOT NULL CHECK (emi > 0),
  tenure_months   integer NOT NULL CHECK (tenure_months > 0),
  start_date      date NOT NULL,
  end_date        date,
  outstanding     numeric(12,2) NOT NULL,
  status          varchar(12) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','closed','written_off')),
  remarks         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      varchar(12),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loans_emp    ON loans(emp_code);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);

CREATE TABLE IF NOT EXISTS loan_emi_schedule (
  id              SERIAL PRIMARY KEY,
  loan_id         integer NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  emp_code        varchar(12) NOT NULL REFERENCES employees(emp_code),
  year            smallint NOT NULL,
  month           smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  scheduled_emi   numeric(10,2) NOT NULL,
  actual_emi      numeric(10,2) NOT NULL,
  is_overridden   boolean NOT NULL DEFAULT FALSE,
  override_reason varchar(200),
  overridden_by   varchar(12),
  applied         boolean NOT NULL DEFAULT FALSE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_loansched_emp_period ON loan_emi_schedule(emp_code, year, month);

-- reuse the existing public.set_updated_at() trigger fn
DROP TRIGGER IF EXISTS trg_loans_updated_at ON loans;
CREATE TRIGGER trg_loans_updated_at
  BEFORE UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
