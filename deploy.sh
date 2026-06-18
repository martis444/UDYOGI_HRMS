#!/bin/bash
# deploy.sh — Udyogi HRMS TEST deployment (port 8080, old system untouched)
# Run this ON THE SERVER, from the repo root, after .env.production and the DB
# init dump are in place. It does NOT stop anything and does NOT touch port 80.

set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"

echo "==> (optional) pulling latest code"
# Uncomment if you deploy via git on the server:
# git pull origin main

echo "==> building images (first build is slow: 5-15 min)"
$COMPOSE build

echo "==> starting containers"
$COMPOSE up -d

echo "==> waiting for services to come up"
sleep 15

echo "==> container status"
$COMPOSE ps

echo "==> health check THROUGH Caddy on 8080"
# Backend health via the proxy. If your backend health route is not /api/health,
# fix the path here after confirming it in backend/app/main.py.
if curl -fsS http://localhost:8080/api/health >/dev/null; then
  echo "    backend: OK"
else
  echo "    WARNING: backend health check failed — run: $COMPOSE logs backend"
fi

# Frontend root via the proxy.
if curl -fsS http://localhost:8080/ >/dev/null; then
  echo "    frontend: OK"
else
  echo "    WARNING: frontend check failed — run: $COMPOSE logs frontend"
fi

echo ""
echo "==> Done. Test from your laptop:  http://YOUR_VPS_IP:8080/"
echo "    Logs:        $COMPOSE logs -f"
echo "    Stop:        $COMPOSE down         (keeps the DB volume)"
echo "    Wipe DB:     $COMPOSE down -v       (DELETES the test database volume)"
