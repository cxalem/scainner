// Runtime half of the typed-dictionary i18n system — dictionary.ts is the
// shape, en.ts/es.ts are the two locales. Same architecture as the desktop
// app's apps/desktop/src/i18n/index.tsx, adapted for React Native:
// device locale comes from expo-localization instead of navigator.language,
// and the explicit preference persists in AsyncStorage (async, so the
// stored value is applied in an effect after first render — a one-frame
// locale flash at worst, only for users who overrode their device locale).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Dictionary } from "./dictionary";
import { en } from "./en";
import { es } from "./es";
export type { Dictionary } from "./dictionary";

export type Locale = "en" | "es";

const DICTIONARIES: Record<Locale, Dictionary> = { en, es };
const STORAGE_KEY = "scainner.locale";

// Pure on purpose (no device access hidden inside) — same testable shape as
// the desktop detectLocale. Detection order: explicit stored preference,
// then the device language, then English.
export function detectLocale(storedValue: string | null, deviceLanguageCode: string | null | undefined): Locale {
  if (storedValue === "en" || storedValue === "es") return storedValue;
  return (deviceLanguageCode ?? "").toLowerCase().startsWith("es") ? "es" : "en";
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    detectLocale(null, getLocales()[0]?.languageCode),
  );

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (!cancelled && (stored === "en" || stored === "es")) setLocaleState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const value = useMemo(() => ({ locale, setLocale, t: DICTIONARIES[locale] }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18nContext(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT/useLocale must be used within I18nProvider (see App.tsx)");
  return ctx;
}

/** The translated dictionary for the current locale — `t.signIn.sendCode`,
 * not `t("signIn.sendCode")`: a typo or a locale missing a key is a `tsc`
 * error, not a silent runtime fallback. */
export function useT(): Dictionary {
  return useI18nContext().t;
}

export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useI18nContext();
  return { locale, setLocale };
}
