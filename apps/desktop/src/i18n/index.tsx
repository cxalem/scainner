import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { en } from "./en";
import { es } from "./es";
import type { Dictionary } from "./dictionary";
export type { Dictionary } from "./dictionary";

export type Locale = "en" | "es";

const DICTIONARIES: Record<Locale, Dictionary> = { en, es };
const STORAGE_KEY = "scainner.locale";

export function detectLocale(storedValue: string | null, navigatorLanguage: string | null | undefined): Locale {
  if (storedValue === "en" || storedValue === "es") return storedValue;
  const lang = (navigatorLanguage ?? "").toLowerCase();
  return lang.startsWith("es") ? "es" : "en";
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    detectLocale(window.localStorage.getItem(STORAGE_KEY), window.navigator.language),
  );

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const value = useMemo(() => ({ locale, setLocale, t: DICTIONARIES[locale] }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18nContext(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT/useLocale must be used within I18nProvider (see main.tsx)");
  return ctx;
}

export function useT(): Dictionary {
  return useI18nContext().t;
}

export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useI18nContext();
  return { locale, setLocale };
}
