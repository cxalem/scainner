import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";

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
