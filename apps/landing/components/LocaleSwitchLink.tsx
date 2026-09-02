"use client";

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
        }
      }}
    >
      {children}
    </a>
  );
}
