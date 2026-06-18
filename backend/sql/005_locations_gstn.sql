-- SESSION 14.1 — Locations (GSTN) module.
-- Replaces the 9 legacy city-codes with the 24 client GSTN unit-locations and
-- remaps all existing employees. DESTRUCTIVE — runs in ONE transaction; any error
-- (esp. the zero-legacy-refs check) aborts the whole thing.
-- Backup taken first: backup_locations_employees_pre_14_1.sql
-- NOTE: file is 005_ (004_ is add_missing_salary_columns).

BEGIN;

-- Views depend on locations.id / employees.location_id — drop, then recreate
-- verbatim after the type changes. (App uses the ORM, not these views.)
DROP VIEW IF EXISTS v_employee_full;
DROP VIEW IF EXISTS v_payslip_summary;

-- ── Part A2: widen id + the three FK columns together (varchar(20)->(40)) ──
ALTER TABLE locations          ALTER COLUMN id          TYPE varchar(40);
ALTER TABLE employees          ALTER COLUMN location_id TYPE varchar(40);
ALTER TABLE attendance_daily   ALTER COLUMN location_id TYPE varchar(40);
ALTER TABLE biometric_mapping  ALTER COLUMN location_id TYPE varchar(40);

-- ── Part A3: status + phone on locations ──
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS status varchar(10) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive')),
  ADD COLUMN IF NOT EXISTS phone varchar(20);

-- ── Part B: the 24 GSTN unit-locations (id = slug of name) ──
-- city='' (admins fill later); entity_id=NULL (group-wide); WB GSTN repeats per state.
INSERT INTO locations (id, name, city, state, entity_id, pt_state_code, gstn, status) VALUES
  ('AHMEDABAD',                'AHMEDABAD',                '', 'GUJARAT',       NULL, 'GJ',  '24AAACU3814F1ZQ', 'active'),
  ('BARASAT-WORKWEAR',         'BARASAT-WORKWEAR',         '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('CHENNAI',                  'CHENNAI',                  '', 'TAMIL NADU',    NULL, 'NIL', '33AAACU3814F1ZR', 'active'),
  ('JPUR-HARNESS',             'JPUR-HARNESS',             '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('JPUR-HELMET',              'JPUR-HELMET',              '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('JPUR-ROPE',                'JPUR-ROPE',                '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('JPUR-SHARED',              'JPUR-SHARED',              '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('JPUR-WAREHOUSE-SCM',       'JPUR-WAREHOUSE (SCM)',     '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('JPUR-WEBBING',            'JPUR-WEBBING',             '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('JPUR-WORKWEAR',            'JPUR-WORKWEAR',            '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('KOLKATA',                  'KOLKATA',                  '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('MUMBAI',                   'MUMBAI',                   '', 'MAHARASHTRA',   NULL, 'MH',  '27AAACU3814F1ZK', 'active'),
  ('NOIDA',                    'NOIDA',                    '', 'UTTAR PRADESH', NULL, 'NIL', '09AAACU3814F1ZI', 'active'),
  ('RANIHATI-BLOCK',           'RANIHATI-BLOCK',           '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('RANIHATI-EXIM',            'RANIHATI-EXIM',            '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('RANIHATI-EYEWEAR',         'RANIHATI-EYEWEAR',         '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('RANIHATI-FABRICATION',     'RANIHATI-FABRICATION',     '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('RANIHATI-HAND-PROTECTION', 'RANIHATI-HAND PROTECTION', '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('RANIHATI-HARNESS',         'RANIHATI-HARNESS',         '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('RANIHATI-MACHINE-SHOP',    'RANIHATI-MACHINE SHOP',    '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('RANIHATI-SHARED',          'RANIHATI-SHARED',          '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('RANIHATI-SHOWER',          'RANIHATI-SHOWER',          '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('RANIHATI-WAREHOUSE-SCM',   'RANIHATI-WAREHOUSE (SCM)', '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active'),
  ('RANIHATI-WORKWEAR',        'RANIHATI-WORKWEAR',        '', 'WEST BENGAL',   NULL, 'WB',  '19AAACU3814F1ZH', 'active')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, state = EXCLUDED.state,
  pt_state_code = EXCLUDED.pt_state_code, gstn = EXCLUDED.gstn, status = EXCLUDED.status;

-- ── Part C: remap. Build the report first (single source of the old→new map). ──
-- UM000001 (golden, jpr/PT=NIL) is special-cased to NOIDA (a genuine PT=NIL unit)
-- so PT stays NIL. All other jpr → JPUR-SHARED (WB). sil/dadra/daman → CHENNAI
-- placeholder (no GSTN unit; PT=NIL preserved).
CREATE TEMP TABLE _remap AS
SELECT
  emp_code,
  location_id AS old_code,
  CASE
    WHEN location_id = 'jpr' AND emp_code = 'UM000001' THEN 'NOIDA'
    WHEN location_id = 'jpr'                            THEN 'JPUR-SHARED'
    WHEN location_id = 'kol'                            THEN 'KOLKATA'
    WHEN location_id = 'how'                            THEN 'RANIHATI-SHARED'
    WHEN location_id = 'pune'                           THEN 'MUMBAI'
    WHEN location_id = 'vapi'                           THEN 'AHMEDABAD'
    WHEN location_id = 'delhi'                          THEN 'NOIDA'
    WHEN location_id IN ('sil','dadra','daman')         THEN 'CHENNAI'
  END AS new_code,
  CASE
    WHEN location_id = 'jpr' AND emp_code = 'UM000001' THEN 'GOLDEN special-case -> PT=NIL unit (NOIDA)'
    WHEN location_id = 'jpr'                            THEN 'PT CHANGE NIL->WB (flag for HR)'
    WHEN location_id IN ('sil','dadra','daman')         THEN 'PLACEHOLDER no-GSTN-unit, PT=NIL preserved (flag for HR)'
    ELSE 'PT preserved'
  END AS note
FROM employees
WHERE location_id IN ('kol','how','pune','vapi','sil','dadra','daman','jpr','delhi');

-- C1: apply to employees (via the report) + biometric_mapping + attendance_daily
UPDATE employees e SET location_id = r.new_code
  FROM _remap r WHERE e.emp_code = r.emp_code;

UPDATE biometric_mapping SET location_id = CASE
    WHEN location_id = 'jpr' AND emp_code = 'UM000001' THEN 'NOIDA'
    WHEN location_id = 'jpr'  THEN 'JPUR-SHARED'
    WHEN location_id = 'kol'  THEN 'KOLKATA'
    WHEN location_id = 'how'  THEN 'RANIHATI-SHARED'
    WHEN location_id = 'pune' THEN 'MUMBAI'
    WHEN location_id = 'vapi' THEN 'AHMEDABAD'
    WHEN location_id = 'delhi' THEN 'NOIDA'
    WHEN location_id IN ('sil','dadra','daman') THEN 'CHENNAI'
    ELSE location_id END
  WHERE location_id IN ('kol','how','pune','vapi','sil','dadra','daman','jpr','delhi');

UPDATE attendance_daily SET location_id = CASE
    WHEN location_id = 'jpr' AND emp_code = 'UM000001' THEN 'NOIDA'
    WHEN location_id = 'jpr'  THEN 'JPUR-SHARED'
    WHEN location_id = 'kol'  THEN 'KOLKATA'
    WHEN location_id = 'how'  THEN 'RANIHATI-SHARED'
    WHEN location_id = 'pune' THEN 'MUMBAI'
    WHEN location_id = 'vapi' THEN 'AHMEDABAD'
    WHEN location_id = 'delhi' THEN 'NOIDA'
    WHEN location_id IN ('sil','dadra','daman') THEN 'CHENNAI'
    ELSE location_id END
  WHERE location_id IN ('kol','how','pune','vapi','sil','dadra','daman','jpr','delhi');

-- C2: REMAP REPORT (printed)
\echo '================= REMAP REPORT ================='
SELECT old_code, new_code, count(*) AS employees, max(note) AS note
FROM _remap GROUP BY old_code, new_code ORDER BY old_code;
\echo '----- per-employee (placeholders / PT changes flagged) -----'
SELECT emp_code, old_code, new_code, note FROM _remap ORDER BY note, emp_code;

-- C3: abort if any employee still on a legacy code
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM employees
    WHERE location_id IN ('kol','how','pune','vapi','sil','dadra','daman','jpr','delhi');
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % employees still reference a legacy location code', n;
  END IF;
END $$;

-- C4: drop the legacy 9
DELETE FROM locations WHERE id IN ('kol','how','pune','vapi','sil','dadra','daman','jpr','delhi');

-- C5: audit log (user_code <=12 chars)
INSERT INTO audit_log (user_code, action, table_name, record_id, new_values)
SELECT 'system', 'LOCATION_REMAP', 'locations', 'SESSION-14.1',
       jsonb_build_object('remapped', jsonb_agg(to_jsonb(r)))
FROM _remap r;

-- Recreate the dropped views (verbatim definitions)
CREATE VIEW v_employee_full AS
 SELECT e.emp_code, e.legacy_code, e.name, e.father_name, e.dob, e.gender,
    e.marital_status, e.mobile, e.email, e.doj, e.entity_id,
    ent.name AS entity_name, e.location_id, l.city AS location_city,
    l.state AS location_state, l.pt_state_code, d.name AS department,
    e.division, e.designation, g.code AS grade, e.reporting_mgr_code,
    s.name AS shift, e.ctc_annual, e.basic, e.hra, e.da, e.spl, e.cca,
    e.basic + e.hra + e.da + e.spl + e.cca AS monthly_gross,
    e.pan, e.uan, e.esic_no, e.bank_name, e.ifsc, e.present_city,
    e.present_state, e.status, u.role
   FROM employees e
     LEFT JOIN entities ent ON ent.id::text = e.entity_id::text
     LEFT JOIN locations l ON l.id::text = e.location_id::text
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN grades g ON g.id = e.grade_id
     LEFT JOIN shifts s ON s.id = e.shift_id
     LEFT JOIN users u ON u.emp_code::text = e.emp_code::text;

CREATE VIEW v_payslip_summary AS
 SELECT pm.id, pm.emp_code, pm.year, pm.month, pm.basic, pm.hra, pm.da, pm.spl,
    pm.cca, pm.gross, pm.pf_emp, pm.pf_ern, pm.esic_emp, pm.esic_ern, pm.pt,
    pm.loan_emi, pm.other_deduction, pm.total_deduction, pm.net_pay,
    pm.total_days, pm.pay_days, pm.days_p, pm.days_a, pm.days_lwp, pm.days_wo,
    pm.days_cl, pm.days_el, pm.days_sl, pm.days_h, pm.ot_hours, pm.status,
    pm.salary_flag, pm.remarks, pm.generated_at, pm.generated_by, pm.locked_at,
    e.name, e.designation, e.bank_name, e.ifsc, l.city AS location_city,
    ent.name AS entity_name, ent.id AS entity_id
   FROM payroll_months pm
     JOIN employees e ON e.emp_code::text = pm.emp_code::text
     JOIN locations l ON l.id::text = e.location_id::text
     JOIN entities ent ON ent.id::text = e.entity_id::text;

COMMIT;
