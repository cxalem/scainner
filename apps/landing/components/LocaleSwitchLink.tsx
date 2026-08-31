"use client";

// A plain <a href="/es/"> here would create a loop: LocaleRedirect on /
// reads the stored preference and, if it's still "es" from a previous
// visit, immediately bounces back to /es/ — so clicking "English" from the
// Spanish footer could never actually land you on the English page. This
// writes the target locale first, so the stored preference always agrees
// with where the click is actually taking you.
import { STORAGE_KEY, type Locale } from "@/lib/i18n/detect";

export function LocaleSwitchLink({ to, href, children, className }: { to: Locale; href: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => {
        try {
          window.localStorage.setItem(STORAGE_KEY, to);
        } catch {
          // Non-fatal — worst case the destination re-detects instead of
          // trusting a stored preference.
        }
      }}
    >
      {children}
    </a>
  );
}
