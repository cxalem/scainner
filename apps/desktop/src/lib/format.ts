// Locale-aware number formatting — Intl.NumberFormat, not a translation
// concern (that's src/i18n/), a genuinely separate problem: Spain reads
// "14,1 V" with a comma decimal separator, "14.1 V" reads as fourteen-
// point-one to an English speaker but as one thousand four hundred ten to
// someone used to comma decimals. Confirmed with Alejandro 2026-08-21
// (docs/workflows/i18n/plan.md).
//
// Wires in as call sites are touched, not a mass find-replace of every
// `.toFixed()` in the app in one pass — this seeds the pattern for
// Diagnose's two voltage displays (Phase 1); the other ~45 sites across
// the app pick it up naturally as their own views get translated (Phase 2).
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
