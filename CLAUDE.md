# UDYOGI HRMS — Project Context
*Auto-loaded by Claude Code. Do not delete.*

## What this project is
Multi-entity HRMS + Payroll platform for Udyogi Group.
Stack: FastAPI (Python 3.12) + PostgreSQL 16 + Next.js 14 + Docker + Caddy.
Deploy target: client VPS, raw IP (no domain), replaces existing Node.js system.

## Four entities
| ID | Prefix | Name |
|----|--------|------|
| UPPL | UP | Udyogi Plastics Pvt Ltd |
| USAPL | US | Udyogi Safety Appliances (P) Ltd |
| UAPL | UA | Udyogi Agritech (P) Ltd |
| UMPL | UM | Udyogi Moulders (P) Ltd |

## Employee code format
`PREFIX + 6-digit zero-padded serial` → `UP000001`
- Generated per entity. Globally unique. **IMMUTABLE after creation.**
- Legacy slash format (`UPPL/2026/00001`) stored in `legacy_code` column only.

## Nine locations → PT state
kol/how → WB | pune → MH | vapi → GJ | sil/dadra/daman/jpr/delhi → NIL

## Roles (hierarchy)
`super_admin` > `entity_admin` > `hr` > `manager` > `employee`
- super_admin sees all 4 entities
- All others scoped to their entity_id — **enforced server-side, never trust frontend**

## Statutory rules (never hardcode — always query statutory_config table)
- PF employee: 12% of (basic+da), cap ₹1,800/month
- PF employer: 13% of (basic+da), cap ₹2,340/month
- ESIC employee: 0.75% of gross (only if gross ≤ ₹21,000)
- ESIC employer: 3.25% of gross (only if gross ≤ ₹21,000)
- PT: resolved from statutory_config by (state_code, gender, gross, month)

## Payslip validation test (must always pass)
emp_code=UM000001, April 2026, Jaipur (PT=NIL)
→ Gross=9349, PF=785, ESIC=71, PT=0, Net=8493

## Non-negotiable rules
1. Every write operation inserts a row to audit_log — no exceptions
2. aadhaar and bank_acc stored as BYTEA encrypted with pgcrypto — never plain text
3. emp_code is immutable — reject any update attempt with HTTP 400
4. esic_applicable auto-set False when gross > 21,000 — recompute on every salary change
5. payroll_months rows are snapshots — never recompute from current salary after locking
6. Locked payroll (status='locked') cannot be reprocessed — return HTTP 400
7. Blank cells in bulk/column-update imports are skipped, never overwrite with empty
8. All DB queries filter by entity_id for non-super_admin users

## File structure
```
backend/
  app/
    api/          auth.py employees.py payslip.py attendance.py biometric.py admin.py statutory.py
    core/         config.py db.py security.py dependencies.py
    models/       employee.py (all SQLAlchemy models)
    schemas/      auth.py employee.py
    services/     payroll_engine.py pt_resolver.py pdf_generator.py import_service.py
    main.py
  scripts/        create_superadmin.py
  sql/            schema_snapshot.sql (← live schema, source of truth) 001_init_schema.sql 002_seed_data.sql 003_salary_structures.sql
  templates/      payslip_template.html
  Dockerfile requirements.txt .env
frontend/
  src/app/        (Next.js 14 App Router)
docker-compose.yml
docker-compose.prod.yml
Caddyfile
PROGRESS.md
PROMPTS.md
```

## Database schema
- **Source of truth: `backend/sql/schema_snapshot.sql`** — full schema-only dump of the live DB (23 tables incl. `salary_structures`). Read it to know real column names/types/constraints instead of guessing.
- It's a generated snapshot, not a migration. Regenerate after any schema change:
  ```
  PGPASSWORD=2399 /Library/PostgreSQL/18/bin/pg_dump -U postgres -h localhost -d udyogi_hrms \
    --schema-only --no-owner --no-privileges -f backend/sql/schema_snapshot.sql
  ```
- `001_/002_/003_` are the historical migrations; the snapshot reflects current reality (including ad-hoc ALTERs run in earlier sessions).

## Current progress
→ See PROGRESS.md for completed/pending sessions.
→ See PROMPTS.md for the next session prompt.
