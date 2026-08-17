#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SECRETS_DIR="$SCRIPT_DIR/../secrets"

umask 077
mkdir -p "$SECRETS_DIR"

if [ ! -f "$SECRETS_DIR/fleet-private-key.pem" ]; then
  openssl ecparam -name prime256v1 -genkey -noout \
    -out "$SECRETS_DIR/fleet-private-key.pem"
fi

openssl ec -in "$SECRETS_DIR/fleet-private-key.pem" -pubout \
  -out "$SECRETS_DIR/fleet-public-key.pem"

if [ ! -f "$SECRETS_DIR/command-proxy-key.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -subj "/CN=vehicle-command" \
    -addext "subjectAltName=DNS:vehicle-command" \
    -keyout "$SECRETS_DIR/command-proxy-key.pem" \
    -out "$SECRETS_DIR/command-proxy-cert.pem"
fi

chmod 600 "$SECRETS_DIR"/*.pem

printf '%s\n' "TeslaNav Docker secrets are ready in deploy/secrets."
printf '%s\n' "Keep fleet-private-key.pem private."
