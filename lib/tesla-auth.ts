import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { redis } from "@/lib/redis";
import type { DeviceSession, TeslaAccount } from "@/types/tesla";

const PHONE_COOKIE = "teslanav_account";
const CAR_COOKIE = "teslanav_car";
const PHONE_SESSION_TTL = 60 * 60 * 24 * 90;
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

export async function createPhoneSession(accountId: string): Promise<void> {
  const token = randomToken();
  await redis.set(`tesla:phone-session:${hashToken(token)}`, accountId, {
    ex: PHONE_SESSION_TTL,
  });
  const cookieStore = await cookies();
  cookieStore.set(PHONE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PHONE_SESSION_TTL,
  });
}

export async function getPhoneAccount(): Promise<TeslaAccount | null> {
  const token = (await cookies()).get(PHONE_COOKIE)?.value;
  if (!token) return null;
  const accountId = await redis.get<string>(
    `tesla:phone-session:${hashToken(token)}`
  );
  if (!accountId) return null;
  return redis.get<TeslaAccount>(`tesla:account:${accountId}`);
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
  await redis.set(`tesla:car-session:${hashToken(token)}`, session, {
    ex: CAR_SESSION_TTL,
  });
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
  return redis.get<DeviceSession>(`tesla:car-session:${hashToken(token)}`);
}

export async function clearSessions(): Promise<void> {
  const cookieStore = await cookies();
  const phoneToken = cookieStore.get(PHONE_COOKIE)?.value;
  const carToken = cookieStore.get(CAR_COOKIE)?.value;
  const pipeline = redis.pipeline();
  if (phoneToken) pipeline.del(`tesla:phone-session:${hashToken(phoneToken)}`);
  if (carToken) pipeline.del(`tesla:car-session:${hashToken(carToken)}`);
  await pipeline.exec();
  cookieStore.delete(PHONE_COOKIE);
  cookieStore.delete(CAR_COOKIE);
}

export function hasPaidAccess(account: TeslaAccount): boolean {
  return (
    process.env.TESLANAV_BILLING_BYPASS === "true" ||
    account.subscriptionStatus === "active" ||
    account.subscriptionStatus === "trialing"
  );
}
