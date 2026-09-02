import Stripe from "npm:stripe@18";
import { env } from "./http.ts";

export const CATALOG_KEYS = [
  "single",
  "pack_5",
  "pack_20",
  "subscription_monthly",
] as const;
export type CatalogItem = typeof CATALOG_KEYS[number];

export const creditsForItem = (item: CatalogItem): number =>
  ({
    single: 1,
    pack_5: 5,
    pack_20: 20,
    subscription_monthly: 0,
  })[item];

export const priceEnvForItem = (item: CatalogItem): string =>
  ({
    single: "STRIPE_PRICE_SINGLE",
    pack_5: "STRIPE_PRICE_PACK_5",
    pack_20: "STRIPE_PRICE_PACK_20",
    subscription_monthly: "STRIPE_PRICE_SUBSCRIPTION_MONTHLY",
  })[item];

export const itemForPrice = (
  priceId: string,
  configured: Record<CatalogItem, string>,
): CatalogItem | null =>
  CATALOG_KEYS.find((item) => configured[item] === priceId) ?? null;

export const configuredPrices = (): Record<CatalogItem, string> =>
  Object.fromEntries(
    CATALOG_KEYS.map((item) => [item, env(priceEnvForItem(item))]),
  ) as Record<CatalogItem, string>;

export const stripeClient = () =>
  new Stripe(env("STRIPE_SECRET_KEY"), {
    apiVersion: "2025-08-27.basil",
    httpClient: Stripe.createFetchHttpClient(),
  });
