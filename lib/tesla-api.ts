import { createHash } from "crypto";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/tesla-auth";
import type { TeslaAccount, TeslaVehicle } from "@/types/tesla";

const AUTH_BASE = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3";
const AUTHORIZE_URL = "https://auth.tesla.com/oauth2/v3/authorize";
const DEFAULT_API_BASE = "https://fleet-api.prd.na.vn.cloud.tesla.com";

const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().default(28800),
  id_token: z.string().optional(),
});

const vehicleListSchema = z.object({
  response: z.array(
    z.object({
      vin: z.string(),
      display_name: z.string().optional(),
      state: z.string().optional(),
    })
  ),
});

const userSchema = z.object({
  response: z.object({
    email: z.string().email().nullable().optional(),
  }),
});

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subject: string;
}

function config(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBase: string;
} {
  const clientId = process.env.TESLA_CLIENT_ID;
  const clientSecret = process.env.TESLA_CLIENT_SECRET;
  const redirectUri = process.env.TESLA_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Tesla OAuth environment variables are not configured");
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    apiBase: process.env.TESLA_FLEET_API_BASE_URL ?? DEFAULT_API_BASE,
  };
}

function jwtSubject(token: string | undefined, fallback: string): string {
  if (!token) return fallback;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : fallback;
  } catch {
    return fallback;
  }
}

export function buildTeslaAuthorizeUrl(state: string, nonce: string): string {
  const { clientId, redirectUri } = config();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope:
      "openid offline_access user_data vehicle_device_data vehicle_location",
    state,
    nonce,
    prompt_missing_scopes: "true",
    require_requested_scopes: "true",
    show_keypair_step: "true",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeTeslaCode(code: string): Promise<OAuthTokens> {
  const { clientId, clientSecret, redirectUri, apiBase } = config();
  const response = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      audience: apiBase,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Tesla token exchange failed (${response.status})`);
  }
  const token = tokenSchema.parse(await response.json());
  const fallback = createHash("sha256").update(token.access_token).digest("hex");
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    subject: jwtSubject(token.id_token, fallback),
  };
}

async function teslaFetch(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<Response> {
  const apiBase = process.env.TESLA_FLEET_API_BASE_URL ?? DEFAULT_API_BASE;
  return fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
}

export async function fetchTeslaProfile(
  accessToken: string
): Promise<{ email: string | null; vehicles: TeslaVehicle[] }> {
  const [userResponse, vehicleResponse] = await Promise.all([
    teslaFetch("/api/1/users/me", accessToken),
    teslaFetch("/api/1/vehicles", accessToken),
  ]);
  if (!userResponse.ok || !vehicleResponse.ok) {
    throw new Error("Tesla account details could not be loaded");
  }
  const user = userSchema.parse(await userResponse.json());
  const vehicleList = vehicleListSchema.parse(await vehicleResponse.json());
  return {
    email: user.response.email ?? null,
    vehicles: vehicleList.response.map((vehicle) => ({
      vin: vehicle.vin,
      displayName: vehicle.display_name ?? `Tesla ${vehicle.vin.slice(-4)}`,
      state: vehicle.state,
    })),
  };
}

export async function refreshTeslaAccount(
  account: TeslaAccount
): Promise<TeslaAccount> {
  if (account.accessTokenExpiresAt > Date.now() + 60_000) return account;
  const { clientId } = config();
  const response = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: decryptSecret(account.refreshToken),
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Tesla authorization needs to be renewed");
  const token = tokenSchema.parse(await response.json());
  return {
    ...account,
    accessToken: encryptSecret(token.access_token),
    refreshToken: encryptSecret(token.refresh_token),
    accessTokenExpiresAt: Date.now() + token.expires_in * 1000,
    updatedAt: new Date().toISOString(),
  };
}

export async function configureFleetTelemetry(
  account: TeslaAccount
): Promise<void> {
  if (!account.selectedVin) throw new Error("Select a vehicle first");
  const proxyUrl = process.env.TESLA_COMMAND_PROXY_URL;
  const hostname = process.env.TESLA_TELEMETRY_HOSTNAME;
  if (!proxyUrl || !hostname) {
    throw new Error("Fleet Telemetry is not configured on this deployment");
  }
  const response = await fetch(
    `${proxyUrl.replace(/\/$/, "")}/api/1/vehicles/fleet_telemetry_config`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decryptSecret(account.accessToken)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vins: [account.selectedVin],
        config: {
          hostname,
          port: 443,
          ca: process.env.TESLA_TELEMETRY_CA ?? null,
          exp: Math.floor(Date.now() / 1000) + 350 * 24 * 60 * 60,
          fields: {
            RouteLine: {
              interval_seconds: 1,
              resend_interval_seconds: 60,
            },
            DestinationName: {
              interval_seconds: 1,
              resend_interval_seconds: 60,
            },
            DestinationLocation: {
              interval_seconds: 1,
              resend_interval_seconds: 60,
            },
            MilesToArrival: { interval_seconds: 30 },
            MinutesToArrival: { interval_seconds: 30 },
            RouteTrafficMinutesDelay: { interval_seconds: 30 },
          },
        },
      }),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Tesla rejected the telemetry configuration (${response.status}): ${detail.slice(0, 200)}`
    );
  }
}

export async function getFleetTelemetryConnection(
  account: TeslaAccount
): Promise<{
  account: TeslaAccount;
  status: "connected" | "missing" | "unknown";
}> {
  const refreshed = await refreshTeslaAccount(account);
  if (!refreshed.selectedVin) return { account: refreshed, status: "missing" };
  try {
    const response = await teslaFetch(
      `/api/1/vehicles/${encodeURIComponent(refreshed.selectedVin)}/fleet_telemetry_config`,
      decryptSecret(refreshed.accessToken)
    );
    if (response.status === 404) {
      return { account: refreshed, status: "missing" };
    }
    if (!response.ok) {
      return { account: refreshed, status: "unknown" };
    }
    const body = (await response.json()) as {
      response?: {
        synced?: boolean;
        config?: { hostname?: string };
      };
    };
    const expectedHostname = process.env.TESLA_TELEMETRY_HOSTNAME;
    const hostname = body.response?.config?.hostname;
    const hostnameMatches =
      !expectedHostname || !hostname || hostname === expectedHostname;
    return {
      account: refreshed,
      status:
        body.response && body.response.synced !== false && hostnameMatches
          ? "connected"
          : "missing",
    };
  } catch {
    return { account: refreshed, status: "unknown" };
  }
}

export async function removeFleetTelemetry(
  account: TeslaAccount
): Promise<TeslaAccount> {
  if (!account.selectedVin || !process.env.TESLA_COMMAND_PROXY_URL) return account;
  const refreshed = await refreshTeslaAccount(account);
  const response = await fetch(
    `${process.env.TESLA_COMMAND_PROXY_URL.replace(/\/$/, "")}/api/1/vehicles/${encodeURIComponent(account.selectedVin)}/fleet_telemetry_config`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${decryptSecret(refreshed.accessToken)}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Telemetry removal failed (${response.status})`);
  }
  return refreshed;
}

export function virtualKeyPairingUrl(vin: string): string {
  const domain = process.env.TESLA_PARTNER_DOMAIN ?? "teslanav.com";
  return `https://tesla.com/_ak/${domain}?vin=${encodeURIComponent(vin)}`;
}
