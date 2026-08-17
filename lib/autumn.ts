import { Autumn } from "autumn-js";
import { database } from "@/lib/database";

export const TESLA_ROUTE_FEATURE_ID =
  process.env.AUTUMN_TESLA_ROUTE_FEATURE_ID ?? "tesla_route";

function getAutumn(): Autumn {
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  if (!secretKey) throw new Error("AUTUMN_SECRET_KEY is not configured");
  return new Autumn({ secretKey, failOpen: false });
}

interface EntitlementRow {
  allowed: number;
  checked_at: string;
}

const FRESH_ENTITLEMENT_MS = 5 * 60 * 1000;
const OUTAGE_GRACE_MS = 24 * 60 * 60 * 1000;

export async function hasTeslaRouteAccess(
  userId: string,
  forceRefresh: boolean = false
): Promise<boolean> {
  if (process.env.TESLANAV_BILLING_BYPASS === "true") return true;
  if (!process.env.AUTUMN_SECRET_KEY) return false;
  const cached = database
    .prepare(
      "SELECT allowed, checked_at FROM billing_entitlement WHERE user_id = ? AND feature_id = ?"
    )
    .get(userId, TESLA_ROUTE_FEATURE_ID) as EntitlementRow | undefined;
  const cacheAge = cached
    ? Date.now() - new Date(cached.checked_at).getTime()
    : Number.POSITIVE_INFINITY;
  if (!forceRefresh && cached && cacheAge < FRESH_ENTITLEMENT_MS) {
    return cached.allowed === 1;
  }

  try {
    const response = await getAutumn().check({
      customerId: userId,
      featureId: TESLA_ROUTE_FEATURE_ID,
    });
    database
      .prepare(
        `INSERT INTO billing_entitlement (user_id, feature_id, allowed, checked_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, feature_id) DO UPDATE SET
           allowed = excluded.allowed,
           checked_at = excluded.checked_at`
      )
      .run(
        userId,
        TESLA_ROUTE_FEATURE_ID,
        response.allowed ? 1 : 0,
        new Date().toISOString()
      );
    return response.allowed;
  } catch (error) {
    if (cached?.allowed === 1 && cacheAge < OUTAGE_GRACE_MS) {
      console.warn("[Autumn] using cached entitlement during outage");
      return true;
    }
    throw error;
  }
}
