import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { database } from "@/lib/database";
import type { DeviceSession } from "@/types/tesla";

const CAR_COOKIE = "teslanav_car";
const CAR_SESSION_TTL = 60 * 60 * 24 * 365;

function secret(): Buffer {
  const value = process.env.TESLANAV_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("TESLANAV_SESSION_SECRET must contain at least 32 characters");
  }
  return createHash("sha256").update(value).digest();
}

export function randomToken(bytes: number = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptSecret(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted value is malformed");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secret(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function createCarSession(
  accountId: string,
  selectedVin: string
): Promise<void> {
  const token = randomToken();
  const now = new Date();
  const session: DeviceSession = {
    id: randomToken(16),
    accountId,
    selectedVin,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CAR_SESSION_TTL * 1000).toISOString(),
  };
  database
    .prepare(
      `INSERT INTO car_session (
        token_hash, id, user_id, selected_vin, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      hashToken(token),
      session.id,
      session.accountId,
      session.selectedVin,
      session.createdAt,
      session.expiresAt
    );
  (await cookies()).set(CAR_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CAR_SESSION_TTL,
  });
}

export async function getCarSession(): Promise<DeviceSession | null> {
  const token = (await cookies()).get(CAR_COOKIE)?.value;
  if (!token) return null;
  const row = database
    .prepare(
      `SELECT id, user_id, selected_vin, created_at, expires_at
       FROM car_session WHERE token_hash = ? AND expires_at > ?`
    )
    .get(hashToken(token), new Date().toISOString()) as
    | {
        id: string;
        user_id: string;
        selected_vin: string;
        created_at: string;
        expires_at: string;
      }
    | undefined;
  return row
    ? {
        id: row.id,
        accountId: row.user_id,
        selectedVin: row.selected_vin,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      }
    : null;
}

export async function clearCarSession(): Promise<void> {
  const cookieStore = await cookies();
  const carToken = cookieStore.get(CAR_COOKIE)?.value;
  if (carToken) {
    database
      .prepare("DELETE FROM car_session WHERE token_hash = ?")
      .run(hashToken(carToken));
  }
  cookieStore.delete(CAR_COOKIE);
}
