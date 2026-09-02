export type Locale = "en" | "es";

export const STORAGE_KEY = "sonda.landing.locale";

export function detectLocale(storedValue: string | null, navigatorLanguage: string | null | undefined): Locale {
  if (storedValue === "en" || storedValue === "es") return storedValue;
  const lang = (navigatorLanguage ?? "").toLowerCase();
  return lang.startsWith("es") ? "es" : "en";
}
