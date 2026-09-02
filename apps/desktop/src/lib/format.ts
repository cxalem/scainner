import type { Locale } from "@/i18n";

const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-ES" };

function formatNumber(value: number, locale: Locale, fractionDigits: number): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatVoltage(value: number, locale: Locale): string {
  return `${formatNumber(value, locale, 1)} V`;
}
