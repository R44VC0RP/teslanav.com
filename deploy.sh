#!/usr/bin/env bash
set -Eeuo pipefail

VM_HOST="${VM_HOST:-victor-mesa.exe.xyz}"
APP_DIR="${APP_DIR:-/home/exedev/apps/teslanav}"
ENV_FILE="${ENV_FILE:-.env.exe-dev}"
HEALTH_URL="${HEALTH_URL:-https://victor-mesa.exe.xyz/}"
SKIP_CHECKS="${SKIP_CHECKS:-0}"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
LOCK_DIR="/tmp/teslanav-deploy.lock"
SSH_OPTS=(
  -o ConnectTimeout=30
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=6
)

log() { printf '\n\033[1;34m[%s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { printf '\n\033[1;31mDeploy failed:\033[0m %s\n' "$*" >&2; exit 1; }
remote() { ssh "${SSH_OPTS[@]}" "$VM_HOST" "$@"; }

release_lock() {
  remote "rmdir '$LOCK_DIR' 2>/dev/null || true" >/dev/null 2>&1 || true
}
trap release_lock EXIT

[[ -f "$ENV_FILE" ]] || fail "$ENV_FILE is missing"
for key in ADMIN_API_KEY ANALYTICS_HASH_SECRET INBOUND_API_KEY PUBLIC_BASE_URL; do
  grep -q "^${key}=." "$ENV_FILE" || fail "$ENV_FILE is missing $key"
done

log "Checking SSH and acquiring deploy lock"
remote "mkdir '$LOCK_DIR'" || fail "another deploy is already running"
remote "command -v docker >/dev/null && docker compose version >/dev/null"
remote "mkdir -p '$APP_DIR'"

if [[ "$SKIP_CHECKS" != "1" ]]; then
  log "Running local typecheck and production build"
  bunx tsc --noEmit
  bun run build
fi

log "Creating SQLite backup and rollback image tag"
ROLLBACK_META="$(remote "
  set -e
  cd '$APP_DIR'
  container=\$(docker compose ps -q teslanav 2>/dev/null || true)
  if [ -n \"\$container\" ]; then
    mkdir -p /tmp/teslanav-backup-script
    docker compose exec -T teslanav node -e \"const fs=require('fs');const Database=require('better-sqlite3');(async()=>{fs.mkdirSync('/data/backups',{recursive:true});const db=new Database('/data/teslanav.db');await db.backup('/data/backups/teslanav-$RELEASE_ID.db');db.close();console.log('backup ok')})().catch(e=>{console.error(e);process.exit(1)})\"
    image_id=\$(docker inspect \"\$container\" --format '{{.Image}}')
    image_ref=\$(docker inspect \"\$container\" --format '{{.Config.Image}}')
    rollback_ref=teslanav-rollback:$RELEASE_ID
    docker tag \"\$image_id\" \"\$rollback_ref\"
    printf '%s|%s' \"\$image_ref\" \"\$rollback_ref\"
  fi
" | tail -1)"

log "Syncing source and production environment"
remote "mkdir -p '$APP_DIR'"
RSYNC_RSH="ssh ${SSH_OPTS[*]}" rsync -az --delete-delay \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='data/' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.exe-dev' \
  ./ "$VM_HOST:$APP_DIR/"
scp "${SSH_OPTS[@]}" -q "$ENV_FILE" "$VM_HOST:$APP_DIR/.env"
remote "chmod 600 '$APP_DIR/.env' && cd '$APP_DIR' && docker compose config --quiet"

rollback() {
  [[ -n "$ROLLBACK_META" ]] || return 0
  local image_ref="${ROLLBACK_META%%|*}"
  local rollback_ref="${ROLLBACK_META#*|}"
  log "Rolling back to $rollback_ref"
  remote "cd '$APP_DIR' && docker tag '$rollback_ref' '$image_ref' && docker compose up -d --no-build --force-recreate"
}

log "Building and starting release $RELEASE_ID"
if ! remote "cd '$APP_DIR' && docker compose up -d --build"; then
  rollback
  fail "remote build/start failed"
fi

log "Waiting for container health"
healthy=0
for _ in {1..45}; do
  state="$(remote "cd '$APP_DIR' && docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \$(docker compose ps -q teslanav)" 2>/dev/null || true)"
  if [[ "$state" == "healthy" ]]; then healthy=1; break; fi
  if [[ "$state" == "unhealthy" || "$state" == "exited" ]]; then break; fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  remote "cd '$APP_DIR' && docker compose logs --tail=100" || true
  rollback
  fail "container did not become healthy"
fi

log "Checking public HTTPS endpoint"
public_ok=0
for _ in {1..30}; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
  if [[ "$code" == "200" ]]; then public_ok=1; break; fi
  sleep 2
done
if [[ "$public_ok" != "1" ]]; then
  rollback
  fail "$HEALTH_URL did not return 200"
fi

log "Cleaning old artifacts"
remote "
  cd '$APP_DIR'
  docker image prune -f >/dev/null
  docker compose exec -T teslanav sh -lc 'ls -1t /data/backups/teslanav-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f'
  docker images teslanav-rollback --format '{{.Repository}}:{{.Tag}}' | sort -r | tail -n +4 | xargs -r docker rmi >/dev/null 2>&1 || true
"

log "Deploy complete: $HEALTH_URL"
