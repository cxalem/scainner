// The very first screen on a fresh install, shown once ever (App.tsx gates
// on lib/onboarding.ts's persisted flag) — before ConnectGate, before
// anything else. Product-plan.md's 2026-08-21 decision keeps this
// deliberately minimal for v1: language confirmation only, no account, no
// data capture. Previously the locale was silently auto-detected
// (i18n/index.tsx's detectLocale, browser language → English default) and
// only changeable via a small toggle buried in Shell's sidebar — correct
// most of the time, but invisible the moment it guesses wrong, and a driver
// or shop worker whose first language isn't English never got a chance to
// say so before diving in. This surfaces the choice instead of assuming it.
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import { useLocale, type Locale } from "@/i18n";

// Always shown in their own language (English / Español), never translated
// — the universal convention for a language picker, same reason the header
// line below is bilingual rather than routed through useT(): this is the
// one screen in the app that has to read before a locale is chosen.
const LANGUAGES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

export function OnboardingGate({ onDone }: { onDone: () => void }) {
  const { locale, setLocale } = useLocale();

  // One tap both picks and confirms — no separate "Continue" step. The
  // locale useLocale() already reports is I18nProvider's own detectLocale
  // guess, so the detected language already renders as selected; tapping
  // either button (including the one already highlighted) both confirms a
  // correct guess and overrides a wrong one, same gesture either way.
  const choose = (next: Locale) => {
    setLocale(next);
    onDone();
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      {MOCK_MODE && (
        <span className="absolute right-4 top-4 rounded-full bg-warn/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn">
          Demo data
        </span>
      )}
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex items-center gap-2">
          <Gauge className="h-6 w-6 text-primary" aria-hidden="true" />
          <span className="text-lg font-semibold tracking-tight">Scainner</span>
        </div>
        <p className="text-sm text-muted-foreground">Choose your language / Elige tu idioma</p>
        <div role="group" aria-label="Language / Idioma" className="flex items-center gap-3">
          {LANGUAGES.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => choose(l.value)}
              aria-pressed={locale === l.value}
              className={cn(
                "flex h-12 min-w-32 items-center justify-center rounded-full border px-6 text-sm font-medium",
                "transition-[color,background-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                locale === l.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
