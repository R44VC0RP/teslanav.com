#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  ACME_EMAIL=ops@example.com \
  TESLA_TELEMETRY_INGEST_SECRET=shared-secret \
  ./deploy/telemetry/deploy.sh user@ip [telemetry-domain]

Optional environment variables:
  TESLANAV_INGEST_URL         Defaults to https://app.teslanav.com/api/telemetry/ingest
  TELEMETRY_REDIS_PASSWORD    Generated automatically when omitted
  SSH_OPTIONS                 Additional ssh options, for example: -i ~/.ssh/key.pem

Before running:
  1. Point the telemetry domain's A record at the EC2 public/Elastic IP.
  2. Allow inbound TCP 22, 80, and 443 in the EC2 security group.
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 64
fi

TARGET="$1"
TELEMETRY_DOMAIN="${2:-telemetry.teslanav.com}"
ACME_EMAIL="${ACME_EMAIL:-}"
INGEST_SECRET="${TESLA_TELEMETRY_INGEST_SECRET:-}"
INGEST_URL="${TESLANAV_INGEST_URL:-https://app.teslanav.com/api/telemetry/ingest}"
REDIS_PASSWORD="${TELEMETRY_REDIS_PASSWORD:-$(openssl rand -hex 32)}"
REMOTE_DIR="teslanav-telemetry"

if [[ -z "$ACME_EMAIL" || -z "$INGEST_SECRET" ]]; then
  printf '%s\n' "ACME_EMAIL and TESLA_TELEMETRY_INGEST_SECRET are required." >&2
  usage
  exit 64
fi

if [[ ! "$TARGET" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]]; then
  printf '%s\n' "Target must look like user@host." >&2
  exit 64
fi

if [[ ! "$TELEMETRY_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  printf '%s\n' "Telemetry domain contains invalid characters." >&2
  exit 64
fi

if [[ ! "$ACME_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  printf '%s\n' "ACME_EMAIL is not a valid email address." >&2
  exit 64
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"

read -r -a SSH_ARGS <<< "${SSH_OPTIONS:-}"

printf '%s\n' "Checking SSH access to $TARGET..."
ssh "${SSH_ARGS[@]}" -o BatchMode=yes "$TARGET" "true"

printf '%s\n' "Uploading Tesla telemetry stack..."
tar -C "$REPO_ROOT" -czf - \
  docker-compose.telemetry.yml \
  deploy/fleet-telemetry/config.json \
  deploy/telemetry-forwarder/Dockerfile \
  services/telemetry-forwarder.ts \
  package.json \
  bun.lock |
  ssh "${SSH_ARGS[@]}" "$TARGET" \
    "mkdir -p '$REMOTE_DIR' && tar -xzf - -C '$REMOTE_DIR'"

printf '%s\n' "Writing remote telemetry environment..."
printf '%s\n' \
  "TELEMETRY_REDIS_PASSWORD=$REDIS_PASSWORD" \
  "TESLANAV_INGEST_URL=$INGEST_URL" \
  "TESLA_TELEMETRY_INGEST_SECRET=$INGEST_SECRET" |
  ssh "${SSH_ARGS[@]}" "$TARGET" \
    "umask 077; cat > '$REMOTE_DIR/.env.telemetry'"

printf '%s\n' "Installing and starting telemetry services..."
ssh "${SSH_ARGS[@]}" "$TARGET" "bash -s -- '$REMOTE_DIR' '$TELEMETRY_DOMAIN' '$ACME_EMAIL'" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

REMOTE_DIR="$1"
TELEMETRY_DOMAIN="$2"
ACME_EMAIL="$3"
cd "$HOME/$REMOTE_DIR"

if command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' "Docker not found; installing Docker Engine..."
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  $SUDO sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
fi

$SUDO systemctl enable --now docker

if ! $SUDO docker compose version >/dev/null 2>&1; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64) COMPOSE_ARCH="x86_64" ;;
    aarch64|arm64) COMPOSE_ARCH="aarch64" ;;
    *) printf '%s\n' "Unsupported architecture: $ARCH" >&2; exit 1 ;;
  esac
  $SUDO mkdir -p /usr/local/lib/docker/cli-plugins
  $SUDO curl -fsSL \
    "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$COMPOSE_ARCH" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  $SUDO chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

mkdir -p certbot/conf deploy/secrets

CERT_PATH="certbot/conf/live/$TELEMETRY_DOMAIN/fullchain.pem"
if [[ ! -f "$CERT_PATH" ]]; then
  printf '%s\n' "Requesting Let's Encrypt certificate for $TELEMETRY_DOMAIN..."
  $SUDO docker run --rm \
    -p 80:80 \
    -v "$PWD/certbot/conf:/etc/letsencrypt" \
    certbot/certbot:latest certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "$ACME_EMAIL" \
    -d "$TELEMETRY_DOMAIN"
fi

$SUDO cp "certbot/conf/live/$TELEMETRY_DOMAIN/fullchain.pem" \
  deploy/secrets/telemetry-cert.pem
$SUDO cp "certbot/conf/live/$TELEMETRY_DOMAIN/privkey.pem" \
  deploy/secrets/telemetry-key.pem
$SUDO chmod 600 deploy/secrets/telemetry-*.pem

$SUDO docker compose \
  --env-file .env.telemetry \
  -f docker-compose.telemetry.yml \
  pull
$SUDO docker compose \
  --env-file .env.telemetry \
  -f docker-compose.telemetry.yml \
  up -d --build

cat > renew-certificate.sh <<RENEW_SCRIPT
#!/usr/bin/env bash
set -Eeuo pipefail
cd "$HOME/$REMOTE_DIR"
SUDO="$SUDO"
\$SUDO docker run --rm -p 80:80 \
  -v "\$PWD/certbot/conf:/etc/letsencrypt" \
  certbot/certbot:latest renew --standalone --quiet
\$SUDO cp "certbot/conf/live/$TELEMETRY_DOMAIN/fullchain.pem" \
  deploy/secrets/telemetry-cert.pem
\$SUDO cp "certbot/conf/live/$TELEMETRY_DOMAIN/privkey.pem" \
  deploy/secrets/telemetry-key.pem
\$SUDO docker compose --env-file .env.telemetry \
  -f docker-compose.telemetry.yml restart fleet-telemetry
RENEW_SCRIPT
chmod 700 renew-certificate.sh

if command -v crontab >/dev/null 2>&1; then
  CRON_LINE="17 3 * * * $HOME/$REMOTE_DIR/renew-certificate.sh >> $HOME/$REMOTE_DIR/cert-renewal.log 2>&1"
  {
    crontab -l 2>/dev/null | awk -v dir="$HOME/$REMOTE_DIR" 'index($0, dir "/renew-certificate.sh") == 0'
    printf '%s\n' "$CRON_LINE"
  } | crontab -
else
  printf '%s\n' "Warning: crontab is unavailable; run renew-certificate.sh periodically." >&2
fi

$SUDO docker compose \
  --env-file .env.telemetry \
  -f docker-compose.telemetry.yml \
  ps

printf '%s\n' "TESLA_TELEMETRY_CA=$($SUDO base64 -w 0 deploy/secrets/telemetry-cert.pem)"
REMOTE_SCRIPT

printf '\n%s\n' "Telemetry deployment completed."
printf '%s\n' "Copy the printed TESLA_TELEMETRY_CA value into the TeslaNav app environment."
