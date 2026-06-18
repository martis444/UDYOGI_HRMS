-- SESSION 14.2 Part C — belt-and-braces DB guard for the 8 prominent figures.
-- Blocks renaming or deleting UP000001..UP000008 at the DB layer. The API guard
-- in employees.py is the PRIMARY gate; this catches any other path.
-- MUST run AFTER 006_seed_prominent_figures.sql (which legitimately renames them).

CREATE OR REPLACE FUNCTION protect_company_figures() RETURNS trigger AS $$
DECLARE
  protected text[] := ARRAY['UP000001','UP000002','UP000003','UP000004',
                            'UP000005','UP000006','UP000007','UP000008'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.emp_code = ANY(protected) THEN
      RAISE EXCEPTION 'Protected company figure % cannot be deleted', OLD.emp_code;
    END IF;
    RETURN OLD;
  ELSE  -- UPDATE
    IF OLD.emp_code = ANY(protected) AND NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION 'Name of protected company figure % cannot be changed', OLD.emp_code;
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_company_figures ON employees;
CREATE TRIGGER trg_protect_company_figures
  BEFORE UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION protect_company_figures();
