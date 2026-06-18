-- SESSION 14.2 — Seed/reconcile the 8 prominent company figures (UP000001..UP000008).
-- UP000001 is the super_admin — only its employees.name is touched; users/role/password
-- are NEVER altered here. Run BEFORE 007_protect_figures.sql (which would block name edits).
-- Idempotent: re-running is a no-op (name-matches skip, present codes skip insert).
-- employees has no `remarks` column → placeholder flag for UP000005-008 lives in audit_log.

BEGIN;

CREATE TEMP TABLE _seed (code text, canonical text) ON COMMIT DROP;
INSERT INTO _seed VALUES
  ('UP000001','MANOHAR BAGRI'),
  ('UP000002','SUDHIR KUMAR MUNDHRA'),
  ('UP000003','NATWAR BAGRI'),
  ('UP000004','MUKUND GOPALDAS BAGRI'),
  ('UP000005','SHEETAL MUNDHRA'),
  ('UP000006','PRITAM DEB'),
  ('UP000007','SANDIP ROY'),
  ('UP000008','NISHA BAGRI');

-- Pre-state for the reconciliation report + audit
CREATE TEMP TABLE _seed_pre ON COMMIT DROP AS
SELECT s.code, s.canonical, e.name AS old_name,
  CASE WHEN e.emp_code IS NULL THEN 'MISSING'
       WHEN e.name = s.canonical THEN 'NAME-MATCHES'
       ELSE 'NAME-DIFFERS' END AS reconcile
FROM _seed s LEFT JOIN employees e ON e.emp_code = s.code;

\echo '================= RECONCILIATION REPORT ================='
SELECT code, reconcile, old_name, canonical FROM _seed_pre ORDER BY code;

-- Reconcile names on present rows (UP000001-004) — name only.
UPDATE employees e SET name = s.canonical, updated_at = now()
  FROM _seed s WHERE e.emp_code = s.code AND e.name <> s.canonical;

-- Insert missing figures (UP000005-008): minimal valid row, placeholders for DOJ/mobile.
INSERT INTO employees
  (emp_code, name, mobile, doj, entity_id, location_id, status, is_on_probation,
   created_at, updated_at, created_by)
SELECT s.code, s.canonical, '0000000000', DATE '2000-01-01', 'UPPL', 'KOLKATA',
       'active', false, now(), now(), 'system'
FROM _seed s
WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.emp_code = s.code);

-- Maintain the 13.15 invariant: every employee has one active salary_structure (all 0).
INSERT INTO salary_structures (emp_code, effective_from, reason, created_by)
SELECT s.code, DATE '2000-01-01', 'initial', 'seed'
FROM _seed s
WHERE NOT EXISTS (SELECT 1 FROM salary_structures ss WHERE ss.emp_code = s.code);

-- Audit every insert/update.
INSERT INTO audit_log (user_code, action, table_name, record_id, old_values, new_values)
SELECT 'system', 'SEED_PROMINENT_FIGURE', 'employees', p.code,
       jsonb_build_object('old_name', p.old_name, 'reconcile', p.reconcile),
       jsonb_build_object('name', p.canonical,
         'note', CASE WHEN p.reconcile = 'MISSING'
                      THEN 'inserted; doj=2000-01-01 + mobile=0000000000 placeholders, HR to correct'
                      ELSE 'name reconciled' END)
FROM _seed_pre p
WHERE p.reconcile IN ('MISSING','NAME-DIFFERS');

COMMIT;
