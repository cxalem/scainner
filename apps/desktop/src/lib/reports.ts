import type { PriceItem } from "@scainner/core";

export type ReportButtonState = "signed_out" | "no_credit" | "ready" | "waiting" | "generating" | "done";
export type ReportCostKey = "price" | "credit" | "plan";
export type ReportPrimaryKey = "price" | "covered" | "signedOut";

export function reportOfferKeys(input: {
  signedIn: boolean;
  balance: number;
  subscription: { monthly_allowance: number; allowance_used: number } | null;
}): { cost: ReportCostKey; primary: ReportPrimaryKey; planLeft: number } {
  const planLeft = Math.max(0, (input.subscription?.monthly_allowance ?? 0) - (input.subscription?.allowance_used ?? 0));
  if (!input.signedIn) return { cost: input.subscription && planLeft > 0 ? "plan" : input.balance > 0 ? "credit" : "price", primary: "signedOut", planLeft };
  if (input.subscription && planLeft > 0) return { cost: "plan", primary: "covered", planLeft };
  if (input.balance > 0) return { cost: "credit", primary: "covered", planLeft };
  return { cost: "price", primary: "price", planLeft };
}

export function reportButtonState(input: {
  signedIn: boolean;
  balance: number;
  waiting: boolean;
  generating: boolean;
  done: boolean;
}): ReportButtonState {
  if (!input.signedIn) return "signed_out";
  if (input.done) return "done";
  if (input.generating) return "generating";
  if (input.waiting) return "waiting";
  return input.balance > 0 ? "ready" : "no_credit";
}

export function formatPrice(price: PriceItem | null | undefined, locale: "en" | "es"): string {
  if (!price || price.unit_amount == null) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency: price.currency.toUpperCase() }).format(price.unit_amount / 100);
}

export type ReportFacts =
  | { kind: "ride"; minutes: number; sensors: number; samples: number; codes: number }
  | { kind: "code"; code: string; module: string };

const FACTS_COPY = {
  en: {
    minutes: "min",
    sensors: "sensors",
    samples: "samples",
    codes: (count: string, value: number) => (value === 0 ? "no fault codes" : value === 1 ? "1 fault code" : `${count} fault codes`),
  },
  es: {
    minutes: "min",
    sensors: "sensores",
    samples: "muestras",
    codes: (count: string, value: number) => (value === 0 ? "sin códigos de avería" : value === 1 ? "1 código de avería" : `${count} códigos de avería`),
  },
} as const;

export function reportFactsParts(facts: ReportFacts, locale: "en" | "es"): string[] {
  if (facts.kind === "code") return [facts.code, facts.module];
  const copy = FACTS_COPY[locale];
  const number = (value: number) => new Intl.NumberFormat(locale, { useGrouping: true }).format(value);
  return [
    `${number(facts.minutes)} ${copy.minutes}`,
    `${number(facts.sensors)} ${copy.sensors}`,
    `${number(facts.samples)} ${copy.samples}`,
    copy.codes(number(facts.codes), facts.codes),
  ];
}

export function reportFacts(facts: ReportFacts, locale: "en" | "es"): string {
  return reportFactsParts(facts, locale).join(" · ");
}

export function reportSections(markdown: string): Array<{ title: string; body: string }> {
  return markdown.split(/^# /gm).map((part) => part.trim()).filter(Boolean).map((part) => {
    const [title, ...body] = part.split("\n");
    return { title: title.trim(), body: body.join("\n").trim() };
  });
}
