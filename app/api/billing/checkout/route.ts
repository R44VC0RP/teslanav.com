import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import { getPhoneAccount, hasPaidAccess } from "@/lib/tesla-auth";
import { getLinkSession, saveAccount } from "@/lib/tesla-store";

const schema = z.object({ linkId: z.string().min(1) });

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const account = await getPhoneAccount();
    if (!account) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    if (!account.selectedVin) {
      return NextResponse.json({ error: "Select a vehicle first" }, { status: 400 });
    }
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid link session" }, { status: 400 });
    }
    const link = await getLinkSession(parsed.data.linkId);
    if (!link || link.accountId !== account.id) {
      return NextResponse.json({ error: "Link session expired" }, { status: 404 });
    }
    if (hasPaidAccess(account)) {
      return NextResponse.json({ alreadySubscribed: true });
    }

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) throw new Error("STRIPE_PRICE_ID is not configured");
    const stripe = getStripe();
    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: account.email ?? undefined,
        metadata: { teslanavAccountId: account.id },
      });
      customerId = customer.id;
      account.stripeCustomerId = customer.id;
      await saveAccount(account);
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.teslanav.com";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: {
        trial_period_days: 7,
        metadata: {
          teslanavAccountId: account.id,
          linkId: link.id,
        },
      },
      success_url: `${appUrl}/connect?link=${encodeURIComponent(link.id)}&checkout=success`,
      cancel_url: `${appUrl}/connect?link=${encodeURIComponent(link.id)}&checkout=canceled`,
      metadata: {
        teslanavAccountId: account.id,
        linkId: link.id,
      },
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[Billing] checkout failed:", error);
    return NextResponse.json(
      { error: "Unable to start checkout" },
      { status: 500 }
    );
  }
}
