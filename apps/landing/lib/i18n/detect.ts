// Pure on purpose (no window access inside the function) — same pattern as
// the desktop app's detectLocale (apps/desktop/src/i18n/index.tsx), so it's
// directly unit-testable and the redirect component just wires it to
// window.localStorage/navigator.language. Precedence: an explicit stored
// preference wins, then a best-effort guess from the browser/OS locale,
// then English.
export type Locale = "en" | "es";

export const STORAGE_KEY = "sonda.landing.locale";

export function detectLocale(storedValue: string | null, navigatorLanguage: string | null | undefined): Locale {
  if (storedValue === "en" || storedValue === "es") return storedValue;
  const lang = (navigatorLanguage ?? "").toLowerCase();
  return lang.startsWith("es") ? "es" : "en";
}
