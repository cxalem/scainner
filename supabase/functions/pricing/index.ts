import {
  adminClient,
  errorResponse,
  json,
  optionalUser,
  preflight,
} from "../_shared/http.ts";
import {
  CATALOG_KEYS,
  configuredPrices,
  stripeClient,
} from "../_shared/catalog.ts";

let cache: { expires: number; catalog: Record<string, unknown> } | null = null;

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }
  try {
    const user = await optionalUser(request);
    const now = Date.now();
    if (!cache || cache.expires <= now) {
      const stripe = stripeClient();
      const configured = configuredPrices();
      const prices = await Promise.all(
        CATALOG_KEYS.map((item) => stripe.prices.retrieve(configured[item])),
      );
      cache = {
        expires: now + 600_000,
        catalog: Object.fromEntries(
          prices.map((price, index) => [CATALOG_KEYS[index], {
            price_id: price.id,
            currency: price.currency,
            unit_amount: price.unit_amount,
          }]),
        ),
      };
    }
    let account = null;
    if (user) {
      const db = adminClient();
      const [{ data: credits }, { data: subscription }] = await Promise.all([
        db.from("report_credits").select("balance,updated_at").eq(
          "user_id",
          user.id,
        ).maybeSingle(),
        db.from("subscriptions").select(
          "status,plan,monthly_allowance,allowance_used,current_period_end",
        ).eq("user_id", user.id).maybeSingle(),
      ]);
      account = { balance: credits?.balance ?? 0, subscription };
    }
    return json({ catalog: cache.catalog, account });
  } catch (error) {
    return errorResponse(error);
  }
});
