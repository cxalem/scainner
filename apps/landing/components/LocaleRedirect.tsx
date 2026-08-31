"use client";

// Mounted only on the English (/) page — this is the one entry point that
// needs to guess a locale at all; a direct visit to /es/ always shows
// Spanish, no reverse redirect back to English. No manual language
// picker: this is the automatic, system-language half of that request.
// Runs once on mount, after paint, so there's no SSR/export-time flash —
// a static export has no server to read Accept-Language at request time,
// so client-side detection + redirect is the standard host-agnostic
// pattern for this. The stored preference (same key detectLocale reads)
// means a visitor who's already chosen — by landing here on purpose, or
// by a previous visit — never gets redirected against their own choice.
import { useEffect } from "react";
import { detectLocale, STORAGE_KEY } from "@/lib/i18n/detect";

export function LocaleRedirect() {
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage unavailable (private mode, blocked): fall through to
      // detection every visit rather than throwing.
    }
    const detected = detectLocale(stored, window.navigator.language);
    if (!stored) {
      try {
        window.localStorage.setItem(STORAGE_KEY, detected);
      } catch {
        // Non-fatal — just means detection re-runs next visit too.
      }
    }
    if (detected === "es") window.location.replace("/es/");
  }, []);

  return null;
}
