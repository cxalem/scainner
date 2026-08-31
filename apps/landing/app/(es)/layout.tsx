import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";

// The Spanish counterpart to app/(en)/layout.tsx — see that file's comment
// for why this is a second independent root layout rather than one shared
// layout. No locale picker, no auto-redirect logic here: a direct visit to
// /es/ always shows Spanish, full stop — only the English root's
// LocaleRedirect makes an automatic choice, and only away from /.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sonda — Diagnósticos que se entienden de verdad",
  description:
    "Lee cada avería que reporta tu coche, bórrala y entiende qué significa realmente. Diagnóstico OBD-II y UDS para quien es dueño de su coche.",
  icons: { icon: "/brand/sonda-favicon.svg" },
  alternates: { languages: { en: "/", es: "/es/" } },
};

export default function SpanishRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      {/* suppressHydrationWarning: see app/(en)/layout.tsx's comment —
          same browser-extension case, not an app bug. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
