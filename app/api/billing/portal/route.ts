import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getPhoneAccount } from "@/lib/tesla-auth";

export async function POST(): Promise<NextResponse> {
  try {
    const account = await getPhoneAccount();
    if (!account?.stripeCustomerId) {
      return NextResponse.json({ error: "Billing account not found" }, { status: 404 });
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.teslanav.com";
    const portal = await getStripe().billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${appUrl}/account`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    console.error("[Billing] portal failed:", error);
    return NextResponse.json(
      { error: "Unable to open billing settings" },
      { status: 500 }
    );
  }
}
