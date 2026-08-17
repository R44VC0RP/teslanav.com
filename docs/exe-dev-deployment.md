# Deploying TeslaNav with Docker on exe.dev

## Required topology

exe.dev works well for the TeslaNav web application and the private Tesla
vehicle-command proxy. It cannot receive Fleet Telemetry directly.

exe.dev terminates TLS at its edge and does not expose raw public ports. Tesla
vehicles require a direct mutual-TLS connection to the Fleet Telemetry receiver
on public TCP port 443. The client certificate would be lost at exe.dev's TLS
edge, so `telemetry.teslanav.com` must point to a host that exposes raw port 443
or to a managed Fleet Telemetry provider.

```text
Phone / Tesla browser
  -> exe.dev HTTPS edge
  -> TeslaNav container :3000
  -> private vehicle-command container :4443

Tesla vehicle
  -> telemetry.teslanav.com:443 (raw-port VPS, not exe.dev)
  -> official fleet-telemetry container
  -> private Redis
  -> telemetry-forwarder
  -> https://app.teslanav.com/api/telemetry/ingest
```

## 1. Configure the exe.dev application

Clone the repository onto the exe.dev VM, then create the runtime environment:

```bash
cp .env.example .env.production
chmod +x deploy/exe-dev/setup-secrets.sh
./deploy/exe-dev/setup-secrets.sh
```

Fill in `.env.production`. At minimum, production needs:

- `NEXT_PUBLIC_MAPBOX_TOKEN`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `TESLANAV_SESSION_SECRET`
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL=https://app.teslanav.com`
- `AUTUMN_SECRET_KEY`, `AUTUMN_TESLA_ROUTE_FEATURE_ID`, and
  `NEXT_PUBLIC_AUTUMN_PLAN_ID`
- Tesla partner OAuth credentials
- `TESLA_TELEMETRY_HOSTNAME=telemetry.teslanav.com`
- `TESLA_TELEMETRY_CA` containing the base64-encoded receiver certificate chain
- `TESLA_TELEMETRY_INGEST_SECRET`, shared with the telemetry forwarder

The setup script creates:

- Tesla's prime256v1 Fleet API private/public key pair
- An internal TLS certificate for the vehicle-command proxy

Never copy `deploy/secrets/fleet-private-key.pem` into the app container or
commit anything under `deploy/secrets`.

Build and start the exe.dev stack:

```bash
sudo docker compose \
  --env-file .env.production \
  -f docker-compose.exe-dev.yml \
  up -d --build
```

Check it locally:

```bash
curl --fail http://127.0.0.1:3000/connect
sudo docker compose -f docker-compose.exe-dev.yml ps
```

Configure exe.dev's public proxy from your local machine:

```bash
ssh exe.dev share port YOUR_VM_NAME 3000
ssh exe.dev share set-public YOUR_VM_NAME
```

Point `app.teslanav.com` and `teslanav.com` to `YOUR_VM_NAME.exe.xyz` using
CNAME/ALIAS records, then register both hostnames:

```bash
ssh exe.dev domain add YOUR_VM_NAME app.teslanav.com
ssh exe.dev domain add YOUR_VM_NAME teslanav.com
```

Do not register `telemetry.teslanav.com` with exe.dev.

Verify the Tesla public key before registering the partner application:

```bash
curl --fail https://teslanav.com/.well-known/appspecific/com.tesla.3p.public-key.pem
```

Use this OAuth callback in Tesla's developer portal:

```text
https://app.teslanav.com/api/auth/tesla/callback
```

Connect Autumn to Stripe in the Autumn dashboard. Configure a paid plan matching
`NEXT_PUBLIC_AUTUMN_PLAN_ID` and include the feature identified by
`AUTUMN_TESLA_ROUTE_FEATURE_ID`. Autumn owns checkout, subscription state, and
Stripe webhook processing.

## 2. Deploy the Fleet Telemetry receiver

Use a conventional VPS or load balancer where the container receives raw TCP
443 and terminates mTLS itself. Point an A/AAAA record for
`telemetry.teslanav.com` to that host.

Obtain a valid server certificate for `telemetry.teslanav.com` and place its
full chain and private key at:

```text
deploy/secrets/telemetry-cert.pem
deploy/secrets/telemetry-key.pem
```

Create `.env.telemetry`:

```bash
TELEMETRY_REDIS_PASSWORD=generate-a-long-random-password
TESLANAV_INGEST_URL=https://app.teslanav.com/api/telemetry/ingest
TESLA_TELEMETRY_INGEST_SECRET=the-same-secret-used-by-the-app
```

Start the raw-port telemetry stack:

```bash
sudo docker compose \
  --env-file .env.telemetry \
  -f docker-compose.telemetry.yml \
  up -d --build
```

This stack runs Tesla's official receiver with decoded records, a private Redis
dispatcher, and TeslaNav's forwarder. Only port 443 is published; Redis remains
inside Docker.

Before enrolling vehicles, validate the receiver with Tesla's
`check_server_cert.sh`, then set `TESLA_TELEMETRY_CA` on the exe.dev app to:

```bash
base64 -w 0 deploy/secrets/telemetry-cert.pem
```

Restart the application after changing runtime values:

```bash
sudo docker compose \
  --env-file .env.production \
  -f docker-compose.exe-dev.yml \
  up -d
```

## Operations

```bash
sudo docker compose -f docker-compose.exe-dev.yml logs -f app vehicle-command
sudo docker compose -f docker-compose.telemetry.yml logs -f fleet-telemetry telemetry-forwarder
sudo docker compose -f docker-compose.exe-dev.yml pull
sudo docker compose -f docker-compose.exe-dev.yml up -d --build
```

Back up the `teslanav-data` Docker volume, Upstash database, and Fleet API
private key. The Docker volume contains Better Auth users, sessions, Tesla
connections, and persistent car sessions. Losing the private key requires every
customer to pair a new virtual key.
