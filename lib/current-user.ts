import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getAccount } from "@/lib/tesla-store";

export async function getAuthSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function getCurrentTeslaAccount() {
  const session = await getAuthSession();
  if (!session) return null;
  return getAccount(session.user.id);
}
