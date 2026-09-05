# AI reports and billing functions

Required secrets:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `ANTHROPIC_API_KEY`
- `STRIPE_PRICE_SINGLE`
- `STRIPE_PRICE_PACK_5`
- `STRIPE_PRICE_PACK_20`
- `STRIPE_PRICE_SUBSCRIPTION_MONTHLY`
- `CHECKOUT_SUCCESS_URL`
- `CHECKOUT_CANCEL_URL`

`SUBSCRIPTION_MONTHLY_ALLOWANCE` is optional and defaults to `5`. Supabase
supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

```sh
supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... ANTHROPIC_API_KEY=...
supabase secrets set STRIPE_PRICE_SINGLE=... STRIPE_PRICE_PACK_5=... STRIPE_PRICE_PACK_20=... STRIPE_PRICE_SUBSCRIPTION_MONTHLY=...
supabase secrets set CHECKOUT_SUCCESS_URL=... CHECKOUT_CANCEL_URL=...
supabase functions deploy pricing --no-verify-jwt
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy generate-report
```

Register `stripe-webhook` as the Stripe webhook endpoint. Subscribe it to
`checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`,
and `customer.subscription.deleted`.

```sh
cd supabase/functions
deno task test
```
