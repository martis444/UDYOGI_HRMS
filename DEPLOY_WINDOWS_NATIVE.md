# UDYOGI HRMS — Native Windows Server 2016 Deployment Runbook

How the HRMS is deployed and run on the client's physical **Windows Server 2016**
box — **natively, without Docker**. This is the live setup as of 2026-06-22.

> Why native and not Docker: the Linux/Docker stack (the other `Caddyfile` /
> `docker-compose.prod.yml`) targets a Linux host. Server 2016 can't run the
> Linux containers cleanly, so each piece runs as a native Windows process
> instead. (A Hyper-V Ubuntu VM remains the cleaner long-term option — see
> `DEPLOY_HYPERV_UBUNTU.md` — but is not what's deployed today.)

---

## 1. Architecture

```
office PCs (192.168.0.x)
        │  http://10.0.101.1:8080
        ▼
   Caddy  (:8080)  ── reverse proxy, the ONLY port open on the LAN
        ├─ /api/*  , /iclock/*  ─► FastAPI  (uvicorn 127.0.0.1:8000)
        └─ everything else       ─► Next.js  (next start 127.0.0.1:3000)
                                         │
                              PostgreSQL 18 (native, localhost:5432)
```

- One same-origin front door (`:8080`) → **no CORS needed**.
- Backend and frontend bind to `127.0.0.1` only, so they're reachable **just
  through Caddy** — employees can't hit `:8000`/`:3000` directly.
- All three run as **Windows services (NSSM)** → auto-start on boot, survive
  logoff, restart on crash.

**Key paths & facts**
| Thing | Value |
|---|---|
| Project root | `C:\UdyogiHRMS1` |
| PostgreSQL | `C:\Program Files\PostgreSQL\18\bin` · db `udyogi_hrms` · user `postgres` |
| GTK (for WeasyPrint PDFs) | `C:\Program Files\GTK3-Runtime Win64\bin` |
| Reverse proxy config | `Caddyfile.windows` (NOT the Docker `Caddyfile`) |
| Services | `UdyogiBackend`, `UdyogiFrontend`, `UdyogiCaddy` |
| LAN URL for employees | **http://10.0.101.1:8080** |
| Superadmin | `UP000001` / `Udyogi@2026` (reset via `scripts/create_superadmin.py`) |

> Note: the server also shows `192.168.56.1` — that's a leftover **VirtualBox
> host-only** adapter, not the LAN. The real NIC is `10.0.101.1`.

---

## 2. Prerequisites (install once)

1. **PostgreSQL 18** (EDB installer) — native, running on `localhost:5432`.
2. **Python 3.12** + a venv at `C:\UdyogiHRMS1\backend\venv`.
3. **Node.js** (`where node` → e.g. `C:\Program Files\nodejs\node.exe`).
4. **GTK3 runtime** at `C:\Program Files\GTK3-Runtime Win64` — WeasyPrint needs
   pango/cairo. (MSYS2 does **not** work — its latest build drops Server 2016
   support; use the standalone GTK3-Runtime installer.)
5. **Caddy** — `caddy.exe` in `C:\UdyogiHRMS1` (from caddyserver.com or GitHub releases).
6. **NSSM** — `nssm.exe` in `C:\UdyogiHRMS1` (from nssm.cc).

> The server's internet may be behind a TLS-inspecting proxy that blocks
> downloads/builds. If a download fails on the server, fetch it on another PC and
> copy the file over.

---

## 3. First-time setup

### 3.1 Get the code
```
cd C:\
git clone <repo-url> UdyogiHRMS1
```

### 3.2 Backend
```
cd C:\UdyogiHRMS1\backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```
Create `C:\UdyogiHRMS1\backend\.env` (copy from `.env.production.template`) and set
real secrets. **`ENVIRONMENT=production`** (CORS is not needed because Caddy makes
everything same-origin).

### 3.3 Database
PostgreSQL must have the `udyogi_hrms` database. Apply ALL migrations in order:
```
cd C:\UdyogiHRMS1\backend\sql
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d udyogi_hrms -v ON_ERROR_STOP=1 -f 009_remove_da.sql
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d udyogi_hrms -v ON_ERROR_STOP=1 -f 010_leave_buckets.sql
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d udyogi_hrms -v ON_ERROR_STOP=1 -f 011_late_ld.sql
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d udyogi_hrms -v ON_ERROR_STOP=1 -f 012_leave_policy.sql
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d udyogi_hrms -v ON_ERROR_STOP=1 -f 013_widen_mobile.sql
```
> ⚠️ **`git pull` never updates the database.** Schema changes are applied by
> running the new numbered migration(s) manually. The seed dump
> (`backend/sql/init/00_init.sql`) is gitignored and does NOT come down via pull.

Set the superadmin password:
```
cd C:\UdyogiHRMS1\backend
venv\Scripts\activate
python scripts\create_superadmin.py     REM → UP000001 / Udyogi@2026
```

### 3.4 Frontend (production build, same-origin)
Create `C:\UdyogiHRMS1\frontend\.env.local` with the API URL **empty** (so calls
are relative `/api` and go through Caddy — without this, the app defaults to
`http://localhost:8000`, which only works on the server itself):
```
NEXT_PUBLIC_API_URL=
```
Then build:
```
cd C:\UdyogiHRMS1\frontend
npm install
npm run build
```

### 3.5 Firewall — open only 8080 (Administrator prompt)
```
netsh advfirewall firewall add rule name="UDYOGI HRMS 8080" dir=in action=allow protocol=TCP localport=8080
```

### 3.6 Install the three services (Administrator prompt, from `C:\UdyogiHRMS1`)
```
cd C:\UdyogiHRMS1

REM ── Backend ──  (GTK on PATH is REQUIRED for PDF generation in the service)
nssm install UdyogiBackend "C:\UdyogiHRMS1\backend\venv\Scripts\python.exe"
nssm set UdyogiBackend AppDirectory "C:\UdyogiHRMS1\backend"
nssm set UdyogiBackend AppParameters "-m uvicorn app.main:app --host 127.0.0.1 --port 8000"
nssm set UdyogiBackend AppEnvironmentExtra "PATH=C:\Program Files\GTK3-Runtime Win64\bin;C:\Windows\system32;C:\Windows;C:\UdyogiHRMS1\backend\venv\Scripts"
nssm set UdyogiBackend Start SERVICE_AUTO_START

REM ── Frontend ──  (adjust node path if `where node` differs)
nssm install UdyogiFrontend "C:\Program Files\nodejs\node.exe"
nssm set UdyogiFrontend AppDirectory "C:\UdyogiHRMS1\frontend"
nssm set UdyogiFrontend AppParameters "node_modules\next\dist\bin\next start -H 127.0.0.1 -p 3000"
nssm set UdyogiFrontend Start SERVICE_AUTO_START

REM ── Caddy ──
nssm install UdyogiCaddy "C:\UdyogiHRMS1\caddy.exe"
nssm set UdyogiCaddy AppDirectory "C:\UdyogiHRMS1"
nssm set UdyogiCaddy AppParameters "run --config Caddyfile.windows"
nssm set UdyogiCaddy Start SERVICE_AUTO_START
```
Start them:
```
nssm start UdyogiBackend
nssm start UdyogiFrontend
nssm start UdyogiCaddy
```
Verify each is `RUNNING`:
```
sc query UdyogiBackend & sc query UdyogiFrontend & sc query UdyogiCaddy
```
Then browse to **http://10.0.101.1:8080** from an office PC.

---

## 4. Day-to-day operations

### Deploying an update
```
cd C:\UdyogiHRMS1
git pull
```
Then, depending on what changed:
- **Frontend changed** → `cd frontend && npm run build` → `nssm restart UdyogiFrontend`
- **Backend changed** → `nssm restart UdyogiBackend` (run `pip install -r requirements.txt` first only if it changed)
- **Schema changed** → run the new `backend\sql\0NN_*.sql` migration via psql, then `nssm restart UdyogiBackend`

### Service control
```
nssm restart UdyogiBackend
nssm stop UdyogiCaddy
nssm start UdyogiCaddy
sc query UdyogiFrontend
```
GUI alternative: `services.msc`.

### Logs
Point a service at a log file (once), then restart it:
```
mkdir C:\UdyogiHRMS1\logs
nssm set UdyogiBackend AppStdout "C:\UdyogiHRMS1\logs\backend.log"
nssm set UdyogiBackend AppStderr "C:\UdyogiHRMS1\logs\backend.log"
nssm restart UdyogiBackend
type C:\UdyogiHRMS1\logs\backend.log
```

### Backups (do regularly)
```
"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U postgres -d udyogi_hrms -f C:\Backups\hrms-%date%.sql
```
Copy the dump off the server. The encrypted columns (aadhaar, bank_acc) are
included as-is; keep dumps secure.

---

## 5. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| **PDF download → 500** | WeasyPrint can't find GTK. Ensure the GTK bin folder is on the **backend service's** PATH (`nssm ... AppEnvironmentExtra "PATH=...GTK...;..."`), then `nssm restart UdyogiBackend`. Confirm DLL location with `where /R "C:\Program Files" libgobject-2.0-0.dll`. |
| **Browser "CORS policy" error** | The request actually 500'd (error responses drop CORS headers) OR you're hitting `:3000`/`:8000` directly. Use `:8080`. CORS itself is off because everything is same-origin via Caddy. |
| **Login calls go to `localhost:8000`** | `frontend/.env.local` is missing or `NEXT_PUBLIC_API_URL` isn't empty → rebuild after fixing. |
| **API 401 (e.g. pending-count)** | Login token expired — log out and back in. |
| **Can't reach from office PC** | Use the real NIC IP `10.0.101.1` (not `192.168.56.1`, the VirtualBox adapter); confirm the 8080 firewall rule; `Test-NetConnection 10.0.101.1 -Port 8080`. |
| **DB looks "old" after pull** | `git pull` doesn't touch the DB — apply the missing migration(s) via psql. |
| **Service won't start** | Wrong path in the `nssm` config, or the port is held by a leftover terminal. Check `C:\UdyogiHRMS1\logs\*.log`. |

---

## 6. Data-entry notes (bulk import)

- **emp_code**: leave **blank** → auto-generated (`UP000001` etc.). The old code
  (e.g. `E0204`) goes in the **`legacy_code`** column.
- **dates** (dob, doj): `YYYY-MM-DD` (also DD/MM/YYYY, DD-MM-YYYY).
- **mobile**: 10 digits; multiple numbers separated by `/`
  (`9876543210/9123456780`).
- **entity_id**: `UPPL` / `USAPL` / `UAPL` / `UMPL`.
- Blank cells are skipped, never imported as empty.
