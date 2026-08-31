import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";

// One of two independent root layouts (this one and app/(es)/layout.tsx) —
// Next.js's documented "multiple root layouts" pattern via route groups.
// A single shared layout can't set a per-route <html lang>, and that
// attribute genuinely needs to differ for / (English) vs /es/ (Spanish);
// route groups are the supported way to get two real <html>/<body> roots
// without an awkward /en/ URL segment for the default locale.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const title = "Sonda — Diagnostics you can actually read";
const description =
  "Read every fault your car throws, clear it, and find out what's actually wrong — not just the code. OBD-II and UDS diagnostics for people who own the car.";

export const metadata: Metadata = {
  metadataBase: new URL("https://sondeo-landing.vercel.app"),
  title,
  description,
  icons: { icon: "/brand/sonda-favicon.svg" },
  alternates: { languages: { en: "/", es: "/es/" } },
  openGraph: {
    title,
    description,
    url: "/",
    siteName: "Sonda",
    locale: "en_US",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function EnglishRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      {/* suppressHydrationWarning: not masking a real mismatch — browser
          extensions (Grammarly's data-gr-ext-installed/data-new-gr-c-s-*
          are the common case) inject attributes onto <body> before React
          hydrates. React's own hydration-mismatch message calls this exact
          case out; this is the documented fix, not a workaround for an
          actual bug in this component. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
