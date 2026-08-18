import { database } from "@/lib/database";
import { redis } from "@/lib/redis";
import type { LinkSession, TeslaAccount, TeslaRoute } from "@/types/tesla";

export const LINK_TTL_SECONDS = 10 * 60;
export const ROUTE_TTL_SECONDS = 12 * 60 * 60;

export async function getAccount(id: string): Promise<TeslaAccount | null> {
  const row = database
    .prepare("SELECT * FROM tesla_account WHERE user_id = ?")
    .get(id) as TeslaAccountRow | undefined;
  return row ? accountFromRow(row) : null;
}

export async function saveAccount(account: TeslaAccount): Promise<void> {
  database
    .prepare(
      `INSERT INTO tesla_account (
        user_id, tesla_user_id, email, region, access_token, refresh_token,
        access_token_expires_at, vehicles_json, selected_vin,
        telemetry_configured_at, created_at, updated_at
      ) VALUES (
        @id, @teslaUserId, @email, @region, @accessToken, @refreshToken,
        @accessTokenExpiresAt, @vehiclesJson, @selectedVin,
        @telemetryConfiguredAt, @createdAt, @updatedAt
      )
      ON CONFLICT(user_id) DO UPDATE SET
        tesla_user_id = excluded.tesla_user_id,
        email = excluded.email,
        region = excluded.region,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        access_token_expires_at = excluded.access_token_expires_at,
        vehicles_json = excluded.vehicles_json,
        selected_vin = excluded.selected_vin,
        telemetry_configured_at = excluded.telemetry_configured_at,
        updated_at = excluded.updated_at`
    )
    .run({
      ...account,
      vehiclesJson: JSON.stringify(account.vehicles),
    });
}

export async function findAccountByTeslaUser(
  teslaUserId: string
): Promise<TeslaAccount | null> {
  const row = database
    .prepare("SELECT * FROM tesla_account WHERE tesla_user_id = ?")
    .get(teslaUserId) as TeslaAccountRow | undefined;
  return row ? accountFromRow(row) : null;
}

export async function getLinkSession(id: string): Promise<LinkSession | null> {
  const row = database
    .prepare("SELECT * FROM device_link WHERE id = ?")
    .get(id) as LinkSessionRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    phoneTokenHash: row.phone_token_hash,
    carTokenHash: row.car_token_hash,
    confirmationCode: row.confirmation_code,
    status: row.status as LinkSession["status"],
    accountId: row.user_id,
    selectedVin: row.selected_vin,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function saveLinkSession(link: LinkSession): Promise<void> {
  database
    .prepare(
      `INSERT INTO device_link (
        id, phone_token_hash, car_token_hash, confirmation_code, status,
        user_id, selected_vin, created_at, expires_at
      ) VALUES (
        @id, @phoneTokenHash, @carTokenHash, @confirmationCode, @status,
        @accountId, @selectedVin, @createdAt, @expiresAt
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        user_id = excluded.user_id,
        selected_vin = excluded.selected_vin,
        expires_at = excluded.expires_at`
    )
    .run(link);
}

export async function saveTeslaRoute(route: TeslaRoute): Promise<void> {
  await redis.set(`tesla:route:${route.vin}`, route, {
    ex: ROUTE_TTL_SECONDS,
  });
}

export async function getTeslaRoute(vin: string): Promise<TeslaRoute | null> {
  return redis.get<TeslaRoute>(`tesla:route:${vin}`);
}

interface TeslaAccountRow {
  user_id: string;
  tesla_user_id: string;
  email: string | null;
  region: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: number;
  vehicles_json: string;
  selected_vin: string | null;
  telemetry_configured_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LinkSessionRow {
  id: string;
  phone_token_hash: string;
  car_token_hash: string;
  confirmation_code: string;
  status: string;
  user_id: string | null;
  selected_vin: string | null;
  created_at: string;
  expires_at: string;
}

function accountFromRow(row: TeslaAccountRow): TeslaAccount {
  return {
    id: row.user_id,
    teslaUserId: row.tesla_user_id,
    email: row.email,
    region: row.region,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    accessTokenExpiresAt: row.access_token_expires_at,
    vehicles: JSON.parse(row.vehicles_json) as TeslaAccount["vehicles"],
    selectedVin: row.selected_vin,
    telemetryConfiguredAt: row.telemetry_configured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
