import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const title = "Sonda — Diagnósticos que se entienden de verdad";
const description =
  "Lee cada avería que reporta tu coche, bórrala y entiende qué le pasa de verdad, no solo el código. Diagnóstico OBD-II y UDS para quien es dueño de su coche.";

export const metadata: Metadata = {
  metadataBase: new URL("https://sondeo-landing.vercel.app"),
  title,
  description,
  icons: { icon: "/brand/sonda-favicon.svg" },
  alternates: { languages: { en: "/", es: "/es/" } },
  openGraph: {
    title,
    description,
    url: "/es/",
    siteName: "Sonda",
    locale: "es_ES",
    type: "website",
    images: [{ url: "/og-es.png", width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-es.png"],
  },
};

export default function SpanishRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body suppressHydrationWarning>
        {/* React requires noscript to be the first child of the document body. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
