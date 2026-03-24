import { redis, CACHE_KEYS, CACHE_TTL } from "./redis";
import { User, Session } from "@/types/auth";
import crypto from "crypto";

// Simple JWT implementation (no external library needed)
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";

interface JWTPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * Simple password hashing using crypto (Node.js built-in)
 * For production, consider using bcrypt package
 */
export function hashPassword(password: string): string {
  // Create a random salt
  const salt = crypto.randomBytes(16).toString("hex");
  // Hash password with salt using PBKDF2
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify password against hash
 */
export function verifyPassword(password: string, hash: string): boolean {
  const [salt, originalHash] = hash.split(":");
  const hashAttempt = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return hashAttempt === originalHash;
}

/**
 * Generate JWT token
 */
export function generateToken(userId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 86400 * 7; // 7 days
  const payload: JWTPayload = {
    userId,
    email,
    iat: now,
    exp: now + expiresIn,
  };

  // Simple base64 encoding (not secure for production - use proper JWT library)
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");

  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64");

  return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) return null;

    // Verify signature
    const expectedSignature = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(`${header}.${body}`)
      .digest("base64");

    if (signature !== expectedSignature) return null;

    // Decode payload
    const payload = JSON.parse(Buffer.from(body, "base64").toString());

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Create a new user in Redis
 */
export async function createUser(
  email: string,
  passwordHash: string,
  name?: string,
  provider: "email" | "google" | "apple" = "email",
  providerId?: string
): Promise<User> {
  const userId = crypto.randomUUID();
  const now = Date.now();

  const user: User = {
    id: userId,
    email,
    provider,
    providerId,
    name,
    createdAt: now,
    lastLoginAt: now,
  };

  // Store user by ID
  await redis.set(`${CACHE_KEYS.USER}${userId}`, JSON.stringify(user), {
    ex: CACHE_TTL.USER_SESSION,
  });

  // Store email -> userId mapping
  await redis.set(`${CACHE_KEYS.USER_EMAIL}${email}`, userId, {
    ex: CACHE_TTL.USER_SESSION,
  });

  // If OAuth, store OAuth ID mapping
  if (providerId) {
    await redis.set(`${CACHE_KEYS.USER_OAUTH}${provider}:${providerId}`, userId, {
      ex: CACHE_TTL.USER_SESSION,
    });
  }

  // Store password hash separately (not returned in user object)
  if (passwordHash) {
    await redis.set(`user:password:${userId}`, passwordHash, {
      ex: CACHE_TTL.USER_SESSION,
    });
  }

  return user;
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  const data = await redis.get<string>(`${CACHE_KEYS.USER}${userId}`);
  if (!data) return null;
  return JSON.parse(data);
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const userId = await redis.get<string>(`${CACHE_KEYS.USER_EMAIL}${email}`);
  if (!userId) return null;
  return getUserById(userId);
}

/**
 * Get user by OAuth provider
 */
export async function getUserByOAuth(
  provider: string,
  providerId: string
): Promise<User | null> {
  const userId = await redis.get<string>(
    `${CACHE_KEYS.USER_OAUTH}${provider}:${providerId}`
  );
  if (!userId) return null;
  return getUserById(userId);
}

/**
 * Get password hash for user
 */
export async function getPasswordHash(userId: string): Promise<string | null> {
  return await redis.get<string>(`user:password:${userId}`);
}

/**
 * Create session
 */
export async function createSession(userId: string, token: string): Promise<Session> {
  const session: Session = {
    userId,
    token,
    expiresAt: Date.now() + 86400000 * 30, // 30 days
  };

  const sessionId = crypto.randomUUID();
  await redis.set(`${CACHE_KEYS.USER_SESSION}${sessionId}`, JSON.stringify(session), {
    ex: CACHE_TTL.USER_SESSION,
  });

  // Update user's last login
  const user = await getUserById(userId);
  if (user) {
    user.lastLoginAt = Date.now();
    await redis.set(`${CACHE_KEYS.USER}${userId}`, JSON.stringify(user), {
      ex: CACHE_TTL.USER_SESSION,
    });
  }

  return session;
}

/**
 * Get session
 */
export async function getSession(sessionId: string): Promise<Session | null> {
  const data = await redis.get<string>(`${CACHE_KEYS.USER_SESSION}${sessionId}`);
  if (!data) return null;
  const session = JSON.parse(data);
  if (session.expiresAt < Date.now()) return null;
  return session;
}

/**
 * Delete session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(`${CACHE_KEYS.USER_SESSION}${sessionId}`);
}

/**
 * Get user from request headers (JWT token)
 */
export async function getUserFromToken(token: string): Promise<User | null> {
  const payload = verifyToken(token);
  if (!payload) return null;
  return getUserById(payload.userId);
}

/**
 * Extract token from Authorization header
 */
export function getTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}
