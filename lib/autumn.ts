import { Autumn } from "autumn-js";

export const TESLA_ROUTE_FEATURE_ID =
  process.env.AUTUMN_TESLA_ROUTE_FEATURE_ID ?? "tesla_route";

function getAutumn(): Autumn {
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  if (!secretKey) throw new Error("AUTUMN_SECRET_KEY is not configured");
  return new Autumn({ secretKey, failOpen: false });
}

export async function hasTeslaRouteAccess(userId: string): Promise<boolean> {
  if (process.env.TESLANAV_BILLING_BYPASS === "true") return true;
  if (!process.env.AUTUMN_SECRET_KEY) return false;
  const response = await getAutumn().check({
    customerId: userId,
    featureId: TESLA_ROUTE_FEATURE_ID,
  });
  return response.allowed;
}
