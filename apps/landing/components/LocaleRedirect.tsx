"use client";

import { useEffect } from "react";
import { detectLocale, STORAGE_KEY } from "@/lib/i18n/detect";

export function LocaleRedirect() {
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
    }
    const detected = detectLocale(stored, window.navigator.language);
    if (!stored) {
      try {
        window.localStorage.setItem(STORAGE_KEY, detected);
      } catch {
      }
    }
    if (detected === "es") window.location.replace("/es/");
  }, []);

  return null;
}
