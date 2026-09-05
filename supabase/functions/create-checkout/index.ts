import {
  CATALOG_KEYS,
  type CatalogItem,
  configuredPrices,
  stripeClient,
} from "../_shared/catalog.ts";
import {
  adminClient,
  env,
  errorResponse,
  json,
  preflight,
  requireUser,
} from "../_shared/http.ts";

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  try {
    const user = await requireUser(request);
    const body = await request.json() as { item?: CatalogItem };
    if (!body.item || !CATALOG_KEYS.includes(body.item)) {
      return json({ error: "invalid_item" }, 400);
    }
    const db = adminClient();
    const stripe = stripeClient();
    const { data: existing } = await db.from("stripe_customers").select(
      "stripe_customer_id",
    ).eq("user_id", user.id).maybeSingle();
    let customerId = existing?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      const { error } = await db.from("stripe_customers").insert({
        user_id: user.id,
        stripe_customer_id: customerId,
      });
      if (error) throw error;
    }
    const subscription = body.item === "subscription_monthly";
    const session = await stripe.checkout.sessions.create({
      mode: subscription ? "subscription" : "payment",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: configuredPrices()[body.item], quantity: 1 }],
      success_url: env("CHECKOUT_SUCCESS_URL"),
      cancel_url: env("CHECKOUT_CANCEL_URL"),
      metadata: { item: body.item, user_id: user.id },
      subscription_data: subscription
        ? { metadata: { user_id: user.id, plan: body.item } }
        : undefined,
    });
    return json({ url: session.url });
  } catch (error) {
    return errorResponse(error);
  }
});
