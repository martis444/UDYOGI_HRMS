# Udyogi HRMS — Hyper-V Ubuntu VM Setup (on Windows Server 2016)

**Goal:** the project's stack is all *Linux* containers (Debian/alpine/Postgres/Caddy).
Windows Server 2016 can't run Linux containers cleanly (no WSL2; LCOW deprecated).
So we **don't** run Docker on Windows directly — we run a Linux VM via the Hyper-V
role that Server 2016 already includes, and deploy Docker normally inside it.

This file covers **only** the Hyper-V + Ubuntu layer. Once the VM exists and has
Docker, follow **`DEPLOY_GUIDE_TEST.md`** for the actual app deploy — nothing in
that guide changes; the VM is just a normal Ubuntu box to it.

```
[ Physical box: Windows Server 2016 ]
        └── Hyper-V role
              └── VM: Ubuntu Server 24.04 LTS   ← gets its own LAN IP
                    └── Docker Engine + compose
                          └── docker compose -f docker-compose.prod.yml up -d
                                (postgres · backend · frontend · caddy:8080)
```

---

## Sizing (give the VM real resources)

| Resource | Test | Notes |
|---|---|---|
| vCPU | 4 | Postgres + 3 app containers + builds |
| RAM | 8 GB | `next build` is memory-hungry; 4 GB risks OOM at build |
| Disk | 80 GB | dynamic (thin) is fine |
| VM generation | **Gen 2** | UEFI; Ubuntu supports it |

---

## Phase A — Enable Hyper-V on Server 2016

In an **elevated PowerShell** on the Windows host:

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
```

The server reboots. After reboot, open **Hyper-V Manager** (`virtmgmt.msc`).

> If the host is itself a VM, you must first enable nested virtualization on it
> from its parent host. On bare metal, just confirm Intel VT-x / AMD-V is on in BIOS.

---

## Phase B — Create an External virtual switch

So the VM gets a real IP on the office LAN (reachable by other PCs).

Hyper-V Manager → **Virtual Switch Manager** → **New virtual network switch**
→ type **External** → bind it to the physical NIC that's on the LAN → OK.

- Name it e.g. `LAN-External`.
- Leave "Allow management OS to share this network adapter" **checked** so the host
  keeps its own networking.

(Alternative: use an **Internal/NAT** switch + port-forwarding if you don't want the
VM directly on the LAN. External is simpler — start there.)

---

## Phase C — Create the VM

1. Download **Ubuntu Server 24.04 LTS** ISO on the host (ubuntu.com/download/server).
2. Hyper-V Manager → **New → Virtual Machine**:
   - Generation: **2**
   - Memory: **8192 MB** (you can leave Dynamic Memory off for a server)
   - Network: **LAN-External**
   - Disk: new VHDX, **80 GB**
   - Installation media: the Ubuntu ISO
3. **Before first boot** — VM → Settings → **Security** → either install the
   *Microsoft UEFI Certificate Authority* template, or **uncheck Secure Boot**
   (simplest for Ubuntu). Otherwise Gen-2 won't boot the ISO.
4. Start the VM, connect, and run the Ubuntu installer:
   - Choose **Ubuntu Server (minimized)** is fine.
   - **Install OpenSSH server** when prompted (so you can SSH in from your laptop).
   - Create your admin user (remember the username/password).
5. After install, shut down, **eject the ISO** (Settings → DVD Drive → None), boot again.

---

## Phase D — Network + base setup inside the VM

SSH in from any LAN machine (find the IP with `ip a` in the VM console):

```bash
ssh youruser@VM_IP
```

Update and (recommended) give the VM a **static IP** so it never changes — edit
the netplan file (interface name comes from `ip a`, often `eth0`):

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses: [192.168.1.50/24]      # pick a free LAN IP
      routes:
        - to: default
          via: 192.168.1.1              # your gateway/router
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
```

```bash
sudo netplan apply
```

Open the test port in the VM firewall (Caddy is on 8080 in the test profile):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8080/tcp
sudo ufw enable
```

---

## Phase E — Install Docker in the VM

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER     # run docker without sudo
newgrp docker                     # apply group now (or log out/in)
docker --version && docker compose version
docker run hello-world            # sanity check
```

---

## Phase F — Hand off to the app deploy guide

The VM is now a standard Ubuntu + Docker host. **Switch to `DEPLOY_GUIDE_TEST.md`**
and follow it from **Phase 1 onward** (you've already done its Phase 0 = Docker install):

- get the project onto the VM (`git clone` or `scp`)
- create the seed DB dump and the production `.env` secrets
- `docker compose -f docker-compose.prod.yml up -d`

When it's up, browse from any LAN PC to:

```
http://VM_IP:8080
```

That's the new system, fully isolated from anything on the Windows host.

---

## Backing up the VM

There are three layers, smallest/most-portable to heaviest. **Do at least #1 (DB
dump) on a schedule and #2 (Export) before any risky change.** The Postgres data
lives in the `postgres_data` Docker volume *inside* the VM's disk, so any VM-level
backup (#2, #3) captures the database automatically.

### 1. App database dump (run this on a schedule)
Smallest, fastest, most portable — restorable to any Postgres, not just this VM.
Run inside the VM:

```bash
# dump the running DB container to a timestamped file
docker exec udyogi_db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > ~/hrms-db-$(date +%F).sql.gz
```

Also copy the `uploads/` folder and your `backend/.env.production` (secrets) — those
are the only state outside Postgres. Pull the files off the VM to another machine:

```bash
scp youruser@VM_IP:~/hrms-db-*.sql.gz  ./        # from your laptop
```

Automate daily with cron in the VM (`crontab -e`):

```cron
0 1 * * * docker exec udyogi_db pg_dump -U postgres udyogi_hrms | gzip > /home/youruser/backups/hrms-db-$(date +\%F).sql.gz
```

Restore: `gunzip -c hrms-db-DATE.sql.gz | docker exec -i udyogi_db psql -U postgres -d udyogi_hrms`

### 2. Hyper-V Export (full, portable VM backup)
Captures the entire VM — OS, Docker, volumes, config — as a folder you can copy to
an external/network drive and re-import on any Hyper-V host. **Best full backup.**

PowerShell on the Windows host:

```powershell
# live export works while the VM runs; for a guaranteed-consistent DB, stop it first
Export-VM -Name "UDYOGI-HRMS" -Path "E:\Backups\hrms"
```

Restore: Hyper-V Manager → **Import Virtual Machine** → point at the exported folder.

### 3. Hyper-V Checkpoint (fast rollback point, NOT a real backup)
Instant point-in-time snapshot — use it **right before** an OS upgrade or a risky
deploy so you can roll back in seconds. It is *not* a backup: it lives on the same
physical disk as the VM, so a disk failure loses both.

```powershell
Checkpoint-VM -Name "UDYOGI-HRMS" -SnapshotName "pre-upgrade $(Get-Date -Format yyyy-MM-dd)"
```

Roll back via Hyper-V Manager → right-click the checkpoint → **Apply**. Delete old
checkpoints once you're confident — they grow and slow disk I/O over time.

> **Don't rely only on checkpoints.** They're rollback convenience, not disaster
> recovery. Combine: checkpoint before changes (#3), daily DB dump off-box (#1),
> periodic full Export to another drive (#2).

### Consistency note
For a crash-consistent DB in a *live* export/checkpoint, Postgres replays its WAL on
start and is normally fine. For a guaranteed-clean copy, `docker compose stop` (or
shut the VM down) before #2/#3, or just prefer the logical dump in #1.

---

## Operations notes

- **Backups:** see the **Backing up the VM** section above.
- **Autostart:** Hyper-V Manager → VM Settings → **Automatic Start Action** →
  "Always start automatically". The containers already use `restart: unless-stopped`,
  so the stack comes back after a VM reboot on its own.
- **Go-live (port 80):** per `docker-compose.prod.yml`, change Caddy's mapping from
  `8080:80` to `80:80`, open `80/tcp` in `ufw`, and (if other LAN users hit it)
  ensure nothing on the *Windows host* is already using port 80. Only do this after
  sign-off — see "THE ONE RULE" in `DEPLOY_GUIDE_TEST.md`.

---

## Why a VM and not native Windows Docker

| Option | Verdict |
|---|---|
| Hyper-V Ubuntu VM | ✅ This guide — clean, supported, zero changes to the Docker setup |
| Docker Desktop + WSL2 on the host | ❌ WSL2 needs Server 2019+ — not on 2016 |
| Windows containers | ❌ No practical Windows base for alpine/Debian/Postgres/Caddy |
| Native installs (no Docker) | ❌ WeasyPrint's Pango/Cairo/GTK deps are painful on Windows |
