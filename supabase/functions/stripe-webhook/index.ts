import type Stripe from "npm:stripe@18";
import {
  configuredPrices,
  creditsForItem,
  itemForPrice,
  stripeClient,
} from "../_shared/catalog.ts";
import { adminClient, env, errorResponse, json } from "../_shared/http.ts";

const allowance = () =>
  Number.parseInt(Deno.env.get("SUBSCRIPTION_MONTHLY_ALLOWANCE") ?? "5", 10);

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature) return json({ error: "missing_signature" }, 400);
    const stripe = stripeClient();
    const event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      env("STRIPE_WEBHOOK_SECRET"),
    );
    const db = adminClient();
    const { error: claimError } = await db.from("stripe_events").insert({
      id: event.id,
      type: event.type,
    });
    if (claimError?.code === "23505") {
      return json({ received: true, duplicate: true });
    }
    if (claimError) throw claimError;

    if (event.type === "checkout.session.completed") {
      await handleCheckout(db, event);
    }
    if (event.type === "invoice.paid") await handleInvoice(db, event);
    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await handleSubscription(db, event.data.object as Stripe.Subscription);
    }
    return json({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
});

async function handleCheckout(
  db: ReturnType<typeof adminClient>,
  event: Stripe.Event,
) {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== "payment" || session.payment_status !== "paid") return;
  const userId = session.client_reference_id ?? session.metadata?.user_id;
  if (!userId) throw new Error("Checkout session has no user");
  const stripe = stripeClient();
  const expanded = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items.data.price"],
  });
  const priceId = expanded.line_items?.data[0]?.price?.id;
  const item = priceId ? itemForPrice(priceId, configuredPrices()) : null;
  if (!item || item === "subscription_monthly") {
    throw new Error("Checkout price is not in the credit catalog");
  }
  const credits = creditsForItem(item);
  const { error: ledgerError } = await db.from("credit_ledger").insert({
    user_id: userId,
    delta: credits,
    reason: "purchase",
    stripe_event_id: event.id,
  });
  if (ledgerError) throw ledgerError;
  const { data: current } = await db.from("report_credits").select("balance")
    .eq("user_id", userId).maybeSingle();
  const { error } = await db.from("report_credits").upsert({
    user_id: userId,
    balance: (current?.balance ?? 0) + credits,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function handleInvoice(
  db: ReturnType<typeof adminClient>,
  event: Stripe.Event,
) {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionRef = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof subscriptionRef === "string"
    ? subscriptionRef
    : subscriptionRef?.id;
  if (!subscriptionId) return;
  const stripe = stripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata.user_id;
  if (!userId) throw new Error("Subscription has no user");
  const periodEnd = new Date(
    subscription.items.data[0].current_period_end * 1000,
  ).toISOString();
  const monthlyAllowance = allowance();
  const { error } = await db.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    plan: subscription.metadata.plan ?? "subscription_monthly",
    monthly_allowance: monthlyAllowance,
    allowance_used: 0,
    current_period_end: periodEnd,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  const { error: ledgerError } = await db.from("credit_ledger").insert({
    user_id: userId,
    delta: monthlyAllowance,
    reason: "subscription_grant",
    stripe_event_id: event.id,
  });
  if (ledgerError) throw ledgerError;
}

async function handleSubscription(
  db: ReturnType<typeof adminClient>,
  subscription: Stripe.Subscription,
) {
  const userId = subscription.metadata.user_id;
  if (!userId) return;
  const { error } = await db.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    plan: subscription.metadata.plan ?? "subscription_monthly",
    monthly_allowance: allowance(),
    current_period_end: new Date(
      subscription.items.data[0].current_period_end * 1000,
    ).toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
