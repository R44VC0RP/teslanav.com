import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import {
  findAccountByStripeCustomer,
  getAccount,
  getLinkSession,
  saveAccount,
  saveLinkSession,
} from "@/lib/tesla-store";
import type { SubscriptionStatus } from "@/types/tesla";

function subscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due") return "past_due";
  if (status === "canceled" || status === "unpaid") return "canceled";
  return "inactive";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  try {
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      webhookSecret
    );

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      const accountId = subscription.metadata.teslanavAccountId;
      const account = accountId
        ? await getAccount(accountId)
        : await findAccountByStripeCustomer(customerId);
      if (account) {
        account.stripeCustomerId = customerId;
        account.stripeSubscriptionId = subscription.id;
        account.subscriptionStatus = subscriptionStatus(subscription.status);
        account.updatedAt = new Date().toISOString();
        await saveAccount(account);

        const linkId = subscription.metadata.linkId;
        if (linkId) {
          const link = await getLinkSession(linkId);
          if (link?.accountId === account.id) {
            link.status =
              account.subscriptionStatus === "active" ||
              account.subscriptionStatus === "trialing"
                ? "subscribed"
                : link.status;
            await saveLinkSession(link);
          }
        }
      }
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[StripeWebhook] failed:", error);
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }
}
