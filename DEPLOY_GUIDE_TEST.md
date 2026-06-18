# Udyogi HRMS — First Deployment Guide (TEST, port 8080, no domain)

**Read this once, top to bottom, before touching the server.** This is a *test*
deployment: the new system runs on **port 8080**, the client's existing Node.js system
stays on port 80, fully running. You will not stop or change the old system at all.

The Postgres that ships in this compose file is its own isolated container. It starts
empty and you seed it from a dump of your **local** dev database (test employees only).
That is your "test database." The client's real 1,026 employees are never imported here.

---

## THE ONE RULE

> Stay on **8080**. Do **not** run the cut-over (the pasted prompt's Task 8) and do
> **not** map Caddy to port 80 until there is explicit sign-off for real go-live.
> While you are on 8080, you physically cannot break the old system.

---

## The 4 fixes vs the prompt you pasted

1. `NEXT_PUBLIC_API_URL` → use **`/api`** (relative), not `http://VPS_IP/api`.
2. DB init → **one dump file**, not the whole `backend/sql` folder (which would
   run migrations *and* the schema snapshot and conflict).
3. **Generate real secrets** (no `2399`, no guessable `SECRET_KEY`).
4. **Skip Tasks 8 & 9** (cut-over + cron) for the test phase.

The files in this `deploy/` folder already bake in fixes 1, 2, and 4.

---

## What you need before starting

- SSH access to the VPS and its IP. You log in like: `ssh youruser@YOUR_VPS_IP`
- `sudo` rights on the VPS (to install Docker and open the firewall).
- Your project on the server (via `git clone` your repo, or `scp` it up).
- Your local Postgres running (to make the seed dump in Phase 2).

Replace `YOUR_VPS_IP` everywhere below with the real IP.

---

## Phase 0 — Install Docker on the VPS (skip if already there)

SSH in, then check:

```bash
docker --version && docker compose version
```

If either is missing, install Docker Engine + the compose plugin (Ubuntu):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # lets you run docker without sudo
# log out and back in (or: newgrp docker) so the group takes effect
docker run hello-world             # should print a success message
```

---

## Phase 1 — Prepare the files locally (one Claude Code session)

On your laptop, in the repo, run this prompt in **Claude Code CLI**. It verifies the
Dockerfiles, next.config, and requirements, and drops in the four config files.

> **CLAUDE CODE PROMPT — "14: verify deploy configs (test)"**
>
> Read CLAUDE.md and PROGRESS.md first. We are preparing a TEST deployment on a VPS
> (raw IP, no domain) on port 8080. The existing Node.js system on the server must not
> be touched. Do the following, do not invent ports or domains:
>
> 1. **backend/Dockerfile** — confirm it is a multi-stage build and installs the
>    WeasyPrint system libraries (libpango-1.0-0, libpangocairo-1.0-0, libcairo2,
>    libgdk-pixbuf-2.0-0, libffi-dev, shared-mime-info, fonts). If missing, add them in
>    the runtime stage. The container must run uvicorn on 0.0.0.0:8000. Expose 8000.
> 2. **backend/requirements.txt** — PROGRESS notes WeasyPrint is pinned at 62.3 but
>    production needs 69.0. Bump WeasyPrint to 69.0 (the version that worked in 13.5).
> 3. **frontend/Dockerfile** — multi-stage, Next.js **standalone** output. Accept a
>    build arg `NEXT_PUBLIC_API_URL` and export it as an env before `next build` so it
>    is inlined. Final stage runs `node server.js` on 0.0.0.0:3000. Expose 3000.
> 4. **frontend/next.config.ts** — ensure `output: 'standalone'` is set.
> 5. Confirm the backend health route. Find it in app/main.py. If it is `/api/health`
>    returning `{"status":"ok"}`, good. If it is `/health` (no /api), tell me — the
>    deploy.sh health check and Caddy assume `/api/health` through the proxy.
> 6. Place these four files (I will provide them) at the repo root unchanged:
>    docker-compose.prod.yml, Caddyfile, deploy.sh; and
>    backend/.env.production.template. Add `backend/.env.production` and
>    `backend/sql/init/` to .gitignore (secrets + DB dump must never be committed).
> 7. Do NOT change any application code. Report exactly what you changed in each file.
>
> After it finishes: copy the four files from this guide's `deploy/` folder into the
> repo root (and the template into `backend/`) if Claude Code didn't already.

---

## Phase 2 — Build the test database seed (from your local DB)

This makes a single SQL file that recreates your *local* database (schema + data:
entities, the 24 locations, statutory config, superadmin, your handful of test
employees). That is your test DB on the server.

On your **laptop**:

```bash
mkdir -p backend/sql/init

# Full dump (schema + data), no owner/privilege noise. Uses your local PG18.
PGPASSWORD=2399 /Library/PostgreSQL/18/bin/pg_dump \
  -U postgres -h localhost -d udyogi_hrms \
  --no-owner --no-privileges \
  -f backend/sql/init/00_init.sql

# sanity check: should mention CREATE TABLE, INSERT/COPY, and pgcrypto
grep -c "CREATE TABLE" backend/sql/init/00_init.sql
```

Notes:
- Keep **only this one file** in `backend/sql/init/`. Postgres runs everything in that
  folder on first boot, in order — one clean file = no conflicts.
- **pgcrypto key:** your local data in `aadhaar_enc` / `bank_acc_enc` was encrypted with
  your local key. The server app must use the **same** key (set `PGCRYPTO_KEY` in
  `.env.production` to match local) or decryption will error. For test data this is
  cosmetic, but matching it avoids confusing errors. Check the key's variable name in
  `backend/core/config.py` and mirror it.
- If you'd rather start with a **truly empty** schema and seed fresh instead of dumping
  data, tell me and I'll give you a minimal seed file — but the dump is simpler and
  matches what already works locally.

Commit the config files (NOT the dump, NOT the env):

```bash
git add docker-compose.prod.yml Caddyfile deploy.sh backend/.env.production.template .gitignore
git commit -m "Add test deployment configs (port 8080)"
git push origin main
```

---

## Phase 3 — Get everything onto the server

On the **server**, clone or pull the repo:

```bash
cd ~
git clone YOUR_REPO_URL udyogi    # first time
# or: cd ~/udyogi && git pull origin main
cd ~/udyogi
```

The DB dump and the real env file are gitignored, so copy them up separately from your
**laptop** (run these on the laptop):

```bash
scp backend/sql/init/00_init.sql  youruser@YOUR_VPS_IP:~/udyogi/backend/sql/init/00_init.sql
scp backend/.env.production       youruser@YOUR_VPS_IP:~/udyogi/backend/.env.production
```

You don't have `.env.production` yet — make it now, on the **server**:

```bash
cd ~/udyogi/backend
cp .env.production.template .env.production
# generate two strong secrets:
openssl rand -hex 32   # -> paste into POSTGRES_PASSWORD (and the same into DATABASE_URL)
openssl rand -hex 32   # -> paste into SECRET_KEY
nano .env.production    # fill every __PLACEHOLDER__; save with Ctrl-O, exit Ctrl-X
```

Make the deploy script executable:

```bash
cd ~/udyogi && chmod +x deploy.sh
```

---

## Phase 4 — Find the old system (look, don't touch)

This is Task 6 from your prompt. **Observe only.** You want to know what's on port 80
and what *not* to disturb. Some commands may say "command not found" — that's fine.

```bash
docker ps                                              # any containers already running?
pm2 list 2>/dev/null || echo "no pm2"                  # node often runs under pm2
sudo systemctl list-units --type=service | grep -i node
sudo ss -tlnp | grep -E ':80 |:3000 |:8080 '           # what's listening on which port
```

Confirm **port 8080 is free** (no output for `:8080` above). If something already uses
8080, tell me and we'll pick another (e.g. 8090). Write down what holds port 80 — that's
the old system you'll eventually replace, but **not today**.

---

## Phase 5 — Open the firewall for 8080

First-timers always forget this and then "it works on the server but not from my laptop."

```bash
# If ufw is active:
sudo ufw status
sudo ufw allow 8080/tcp
```

Also: if your VPS provider has a **cloud firewall / security group** (AWS, Oracle,
DigitalOcean, etc.), add an inbound rule for TCP **8080** there too. The OS firewall and
the cloud firewall are separate gates — you need both open.

---

## Phase 6 — Bring it up on 8080

```bash
cd ~/udyogi
./deploy.sh
```

First build takes 5–15 minutes (it's downloading base images and compiling). When it
finishes you'll see container status and health-check lines. Then test:

**On the server:**
```bash
curl -fsS http://localhost:8080/api/health   # expect {"status":"ok"} (or your health JSON)
curl -fsS http://localhost:8080/ | head      # expect HTML from Next.js
```

**From your laptop browser:**
```
http://YOUR_VPS_IP:8080/
```

You should get the liquid-glass login page. Log in with your superadmin
(`UP000001` / `Admin@2026` per PROGRESS, unless you changed it in the dump) and click
through: dashboard, employees, a payslip (download the PDF — that exercises WeasyPrint),
the new Locations/Loans/Credits/About tabs if 14.1–14.5 are in this build.

The old system on port 80 is still serving the whole time. Check it's unaffected:
```
http://YOUR_VPS_IP/        # old system, should look exactly as before
```

---

## Phase 7 — STOP HERE for the test phase

That's the test deployment. Leave it running on 8080 for the client to try. **Do not**
do the cut-over yet. When you're ready for real go-live (separate sign-off), the change
is small and I'll walk you through it: stop the old system, change `"8080:80"` →
`"80:80"` in docker-compose, `docker compose -f docker-compose.prod.yml up -d caddy`,
then set up the backup cron. Not now.

---

## Everyday commands (cheat sheet)

```bash
cd ~/udyogi
docker compose -f docker-compose.prod.yml ps          # status
docker compose -f docker-compose.prod.yml logs -f      # all logs, live
docker compose -f docker-compose.prod.yml logs backend # one service
docker compose -f docker-compose.prod.yml restart backend
docker compose -f docker-compose.prod.yml down         # stop all (KEEPS the DB)
docker compose -f docker-compose.prod.yml down -v      # stop all + DELETE the test DB
docker compose -f docker-compose.prod.yml up -d --build # rebuild + restart after code changes
```

**Re-seeding the test DB:** the dump in `00_init.sql` only runs on the *first* boot
(empty volume). To reload it after changing the dump, wipe and recreate:
```bash
docker compose -f docker-compose.prod.yml down -v   # deletes postgres_data volume
docker compose -f docker-compose.prod.yml up -d     # re-runs 00_init.sql fresh
```

---

## Troubleshooting (the usual first-deploy snags)

- **Browser can't reach `:8080`** → firewall. Re-check Phase 5, both OS and cloud.
- **Login page loads but login fails / API errors in the browser console** → the
  frontend was built with the wrong API URL. Confirm the image was built with
  `NEXT_PUBLIC_API_URL=/api` (it's a build arg, so you must rebuild the frontend after
  changing it: `... up -d --build frontend`).
- **Backend keeps restarting** → `logs backend`. Usually a bad `DATABASE_URL`
  (host must be `postgres`, the service name, not `localhost`) or a missing env var.
- **`pg_isready` / backend can't connect** → the `POSTGRES_PASSWORD` in the env doesn't
  match the one inside `DATABASE_URL`. They must be identical.
- **PDF download 500s** → WeasyPrint system libs missing in the backend image, or
  WeasyPrint still pinned at 62.3. Re-check Phase 1 steps 1–2.
- **DB "init" didn't load my data** → it only runs when the volume is empty. If you
  booted once before adding the dump, do the wipe-and-recreate above.
- **Port 8080 already taken** → pick another (8090) in both the compose `ports:` line
  and the firewall rule.
- **`permission denied` on docker** → you skipped the `usermod -aG docker` + re-login
  in Phase 0.

---

## Files in this bundle

- `docker-compose.prod.yml` — the stack (Caddy on 8080 for test).
- `Caddyfile` — routes `/api/*` and `/iclock/*` to backend, everything else to Next.js.
- `.env.production.template` — copy to `backend/.env.production`, fill with real secrets.
- `deploy.sh` — build + up + health-check on 8080.
- `DEPLOY_GUIDE_TEST.md` — this file.
