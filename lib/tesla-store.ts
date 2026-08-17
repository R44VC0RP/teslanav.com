import { redis } from "@/lib/redis";
import type { LinkSession, TeslaAccount, TeslaRoute } from "@/types/tesla";

export const LINK_TTL_SECONDS = 10 * 60;
export const ROUTE_TTL_SECONDS = 12 * 60 * 60;

export async function getAccount(id: string): Promise<TeslaAccount | null> {
  return redis.get<TeslaAccount>(`tesla:account:${id}`);
}

export async function saveAccount(account: TeslaAccount): Promise<void> {
  await redis.set(`tesla:account:${account.id}`, account);
  await redis.set(`tesla:user-index:${account.teslaUserId}`, account.id);
  if (account.stripeCustomerId) {
    await redis.set(
      `tesla:stripe-customer-index:${account.stripeCustomerId}`,
      account.id
    );
  }
}

export async function findAccountByTeslaUser(
  teslaUserId: string
): Promise<TeslaAccount | null> {
  const id = await redis.get<string>(`tesla:user-index:${teslaUserId}`);
  return id ? getAccount(id) : null;
}

export async function findAccountByStripeCustomer(
  customerId: string
): Promise<TeslaAccount | null> {
  const id = await redis.get<string>(
    `tesla:stripe-customer-index:${customerId}`
  );
  return id ? getAccount(id) : null;
}

export async function getLinkSession(id: string): Promise<LinkSession | null> {
  return redis.get<LinkSession>(`tesla:link:${id}`);
}

export async function saveLinkSession(link: LinkSession): Promise<void> {
  const remaining = Math.max(
    1,
    Math.floor((new Date(link.expiresAt).getTime() - Date.now()) / 1000)
  );
  await redis.set(`tesla:link:${link.id}`, link, { ex: remaining });
}

export async function saveTeslaRoute(route: TeslaRoute): Promise<void> {
  await redis.set(`tesla:route:${route.vin}`, route, {
    ex: ROUTE_TTL_SECONDS,
  });
}

export async function getTeslaRoute(vin: string): Promise<TeslaRoute | null> {
  return redis.get<TeslaRoute>(`tesla:route:${vin}`);
}
