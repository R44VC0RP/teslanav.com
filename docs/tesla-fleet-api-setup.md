# Tesla Fleet API setup for TeslaNav

This guide configures TeslaNav's Tesla OAuth application, Fleet API partner
registration, virtual key, command proxy, and Fleet Telemetry receiver.

## Architecture and domains

TeslaNav uses three related connections:

```text
app.teslanav.com
  Better Auth, Autumn, Tesla OAuth callback, account UI

teslanav.com
  Tesla browser app and hosted Fleet API public key

telemetry.teslanav.com
  Tesla vehicle mTLS receiver on the EC2 public TCP port 443
```

The web application and command proxy run on exe.dev. Fleet Telemetry runs on a
small EC2 instance because Tesla must connect directly with mTLS on port 443.

## 1. Prerequisites

You need:

- A Tesla account with verified email and MFA enabled
- Access to [developer.tesla.com](https://developer.tesla.com/)
- `teslanav.com` and `app.teslanav.com` pointing to the exe.dev deployment
- `telemetry.teslanav.com` pointing to the EC2 Elastic IP
- EC2 inbound TCP 22, 80, and 443
- Docker deployment environment values from `.env.example`
- `jq`, `curl`, and `openssl` on the machine used for partner registration

Tesla Fleet API is usage billed. Add a payment method and billing limit in the
Tesla developer dashboard before onboarding users. Tesla currently provides a
monthly developer discount, but the billing limit still needs to be configured.

## 2. Generate TeslaNav's virtual key

On the exe.dev application host:

```bash
./deploy/exe-dev/setup-secrets.sh
```

This creates:

```text
deploy/secrets/fleet-private-key.pem
deploy/secrets/fleet-public-key.pem
```

The private key is mounted only into Tesla's vehicle-command proxy. Never put it
in an environment variable, browser bundle, telemetry host, or source control.
Back it up securely; replacing it requires users to pair a new virtual key.

Start or restart the exe.dev stack:

```bash
sudo docker compose \
  --env-file .env.production \
  -f docker-compose.exe-dev.yml \
  up -d --build
```

Verify that the public key is reachable without authentication:

```bash
curl --fail \
  https://teslanav.com/.well-known/appspecific/com.tesla.3p.public-key.pem
```

The response must be a PEM public key beginning with:

```text
-----BEGIN PUBLIC KEY-----
```

This URL must remain available for the lifetime of the integration.

## 3. Create the Tesla developer application

In the Tesla developer dashboard, create an application using Authorization
Code access. If the dashboard offers “Authorization Code and
Machine-to-Machine,” select it so the same app can create partner tokens.

Use these values:

| Setting | Value |
|---|---|
| Application domain | `teslanav.com` |
| Allowed origin | `https://teslanav.com` |
| Additional allowed origin | `https://app.teslanav.com` |
| OAuth callback | `https://app.teslanav.com/api/auth/tesla/callback` |

Request only the scopes TeslaNav currently uses:

| Scope | Purpose |
|---|---|
| `openid` | Identify the Tesla account |
| `offline_access` | Rotate access using a refresh token |
| `user_data` | Read the authorized account profile |
| `vehicle_device_data` | List the user's vehicles |
| `vehicle_location` | Receive destination and `RouteLine` telemetry |

The application code requests these scopes explicitly. Tesla may take several
minutes to apply dashboard scope changes.

Copy the generated client credentials into `.env.production`:

```bash
TESLA_CLIENT_ID=...
TESLA_CLIENT_SECRET=...
TESLA_REDIRECT_URI=https://app.teslanav.com/api/auth/tesla/callback
TESLA_PARTNER_DOMAIN=teslanav.com
TESLA_FLEET_API_BASE_URL=https://fleet-api.prd.na.vn.cloud.tesla.com
TESLA_FLEET_REGION=na
```

Keep `TESLA_CLIENT_SECRET` server-side.

## 4. Register the partner account

Tesla requires partner registration in every region where the application
operates. North America also serves Asia-Pacific outside China.

Set the credentials locally:

```bash
export TESLA_CLIENT_ID="..."
export TESLA_CLIENT_SECRET="..."
export TESLA_PARTNER_DOMAIN="teslanav.com"
```

Use this helper to register one region:

```bash
register_tesla_region() {
  local fleet_api_base="$1"
  local partner_token

  partner_token="$(
    curl --fail --silent --show-error \
      --request POST \
      --header "Content-Type: application/x-www-form-urlencoded" \
      --data-urlencode "grant_type=client_credentials" \
      --data-urlencode "client_id=$TESLA_CLIENT_ID" \
      --data-urlencode "client_secret=$TESLA_CLIENT_SECRET" \
      --data-urlencode "scope=openid vehicle_device_data" \
      --data-urlencode "audience=$fleet_api_base" \
      "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token" |
      jq --exit-status --raw-output ".access_token"
  )"

  curl --fail --silent --show-error \
    --request POST \
    --header "Authorization: Bearer $partner_token" \
    --header "Content-Type: application/json" \
    --data "{\"domain\":\"$TESLA_PARTNER_DOMAIN\"}" \
    "$fleet_api_base/api/1/partner_accounts"
}
```

Register North America/APAC and Europe/MEA:

```bash
register_tesla_region \
  "https://fleet-api.prd.na.vn.cloud.tesla.com"

register_tesla_region \
  "https://fleet-api.prd.eu.vn.cloud.tesla.com"
```

China requires a separate account and application through
[developer.tesla.cn](https://developer.tesla.cn/), including a +86 phone
number. Do not use the global app credentials against the China endpoint.

The registration domain must match the root domain of the allowed origins, and
Tesla must be able to fetch the public key before registration succeeds.

## 5. Deploy Fleet Telemetry on EC2

Point the DNS A record for `telemetry.teslanav.com` at the EC2 Elastic IP, then
run from the TeslaNav repository:

```bash
export TESLA_TELEMETRY_INGEST_SECRET="$(openssl rand -hex 32)"

ACME_EMAIL=ops@example.com \
TESLA_TELEMETRY_INGEST_SECRET="$TESLA_TELEMETRY_INGEST_SECRET" \
SSH_OPTIONS="-i ~/.ssh/teslanav-telemetry.pem" \
./deploy/telemetry/deploy.sh ubuntu@EC2_IP
```

Use `ec2-user@EC2_IP` for Amazon Linux.

Save `TESLA_TELEMETRY_INGEST_SECRET`; the exact same value must be configured on
the exe.dev application. The script:

1. Installs Docker when necessary
2. Obtains a Let's Encrypt certificate
3. Starts Tesla's official Fleet Telemetry receiver
4. Starts private Redis and TeslaNav's telemetry forwarder
5. Configures daily certificate renewal
6. Prints `TESLA_TELEMETRY_CA`

`TESLA_TELEMETRY_CA` is transported as base64 in the environment so it remains
one line. TeslaNav decodes it to the raw PEM chain required by Tesla's
`fleet_telemetry_config` request.

## 6. Finish the application environment

Add the telemetry values to `.env.production` on exe.dev:

```bash
TESLA_COMMAND_PROXY_URL=https://vehicle-command:4443
TESLA_TELEMETRY_HOSTNAME=telemetry.teslanav.com
TESLA_TELEMETRY_CA=the-value-printed-by-deploy.sh
TESLA_TELEMETRY_INGEST_SECRET=the-same-secret-used-during-EC2-deployment
```

Then restart:

```bash
sudo docker compose \
  --env-file .env.production \
  -f docker-compose.exe-dev.yml \
  up -d
```

## 7. Validate the telemetry certificate

Tesla's validator expects the `ca` value as raw PEM, not the base64 environment
representation. Decode it and create a validation file:

```bash
printf '%s' "$TESLA_TELEMETRY_CA" | base64 --decode > /tmp/telemetry-ca.pem

jq --rawfile ca /tmp/telemetry-ca.pem \
  --arg hostname "telemetry.teslanav.com" \
  '{hostname: $hostname, port: 443, ca: $ca}' \
  > /tmp/validate-server.json

curl --fail --output /tmp/check-server-cert.sh \
  https://raw.githubusercontent.com/teslamotors/fleet-telemetry/main/tools/check_server_cert.sh

chmod +x /tmp/check-server-cert.sh
/tmp/check-server-cert.sh /tmp/validate-server.json
```

The expected result is `The server certificate is valid.` A partial-chain
warning should be corrected before onboarding users.

## 8. Test one vehicle end to end

1. Open TeslaNav in the Tesla browser.
2. Choose **Connect Tesla** and scan the QR code with a phone.
3. Sign into Tesla and approve the requested scopes.
4. Select the vehicle.
5. Complete the Autumn plan flow or enable the development billing bypass.
6. Choose **Open Tesla app to pair**.
7. Approve TeslaNav's virtual key in the Tesla mobile app.
8. Return to TeslaNav and complete the connection check.
9. Start a route in Tesla's built-in navigation.
10. Confirm the same route appears in TeslaNav.

The pairing deep link generated by TeslaNav is:

```text
https://tesla.com/_ak/teslanav.com?vin=VIN
```

OAuth consent alone is not enough. Fleet Telemetry requires the virtual key to
be paired to each vehicle.

## 9. Verify services and data

On exe.dev:

```bash
sudo docker compose \
  --env-file .env.production \
  -f docker-compose.exe-dev.yml \
  ps

sudo docker compose \
  --env-file .env.production \
  -f docker-compose.exe-dev.yml \
  logs --tail=100 app vehicle-command
```

On EC2:

```bash
cd ~/teslanav-telemetry

sudo docker compose \
  --env-file .env.telemetry \
  -f docker-compose.telemetry.yml \
  ps

sudo docker compose \
  --env-file .env.telemetry \
  -f docker-compose.telemetry.yml \
  logs --tail=100 fleet-telemetry telemetry-forwarder
```

The receiver should report a vehicle connection. The forwarder should report
that it subscribed to Tesla navigation records. `RouteLine` appears only when
the vehicle has an active built-in navigation route.

## Troubleshooting

### `Unregistered account`

- Register the partner account in the vehicle owner's region.
- Verify the public-key URL is publicly reachable.
- Confirm the registered domain and developer-dashboard allowed origin share
  the same root domain.

### `missing_key`

- Complete the `tesla.com/_ak/teslanav.com` pairing flow.
- Ensure the Tesla app is signed into the same account used for OAuth.
- Wait briefly; `fleet_status` key state can lag.

### `unsupported_firmware` or `unsupported_hardware`

- Fleet Telemetry generally requires firmware 2024.26 or later.
- Intel Atom Model S/X requires firmware 2025.20 or later.
- Older vehicles may not support Fleet Telemetry.

### `max_configs`

The vehicle already has the maximum number of third-party telemetry
configurations. Remove an unused integration before adding TeslaNav.

### Certificate or mTLS errors

- Confirm EC2 receives raw public TCP 443; do not put the receiver behind an
  HTTP/TLS-terminating proxy.
- Confirm port 443 is open in the EC2 security group.
- Re-run Tesla's certificate validator.
- Ensure the configured CA chain matches the receiver certificate chain.
- Confirm the TLS certificate includes `telemetry.teslanav.com`.

### OAuth `login_required`

The user changed their Tesla password, revoked consent, or the refresh token
expired. Ask the user to sign into Tesla again.

### OAuth works but no route appears

- Confirm the user granted `vehicle_location`.
- Confirm Tesla's built-in navigation has an active destination.
- Inspect telemetry receiver and forwarder logs.
- Confirm the application and EC2 host share the same
  `TESLA_TELEMETRY_INGEST_SECRET`.

## Official references

- [Fleet API onboarding](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api)
- [Authentication and scopes](https://developer.tesla.com/docs/fleet-api/authentication/overview)
- [Partner tokens](https://developer.tesla.com/docs/fleet-api/authentication/partner-tokens)
- [Partner registration](https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints)
- [Regions](https://developer.tesla.com/docs/fleet-api/getting-started/regions-countries)
- [Virtual keys](https://developer.tesla.com/docs/fleet-api/virtual-keys/developer-guide)
- [Fleet Telemetry](https://developer.tesla.com/docs/fleet-api/fleet-telemetry)
