import type { PriceItem } from "@scainner/core";

export type ReportButtonState = "signed_out" | "no_credit" | "ready" | "waiting" | "generating" | "done";

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

export function reportSections(markdown: string): Array<{ title: string; body: string }> {
  return markdown.split(/^# /gm).map((part) => part.trim()).filter(Boolean).map((part) => {
    const [title, ...body] = part.split("\n");
    return { title: title.trim(), body: body.join("\n").trim() };
  });
}
