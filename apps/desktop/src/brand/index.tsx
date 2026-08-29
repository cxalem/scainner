// Brand identity — the one place the product's name and mark live.
//
// Every surface that shows the name or the logo (login, connect gate,
// sidebar, window title, exports) reads from here, so a rename or a new
// mark is an edit to this file and to public/brand/*.svg — nothing else in
// src/ may spell the product name or draw the logo on its own.
//
// The mark: a three-quarter arc closing on a dot (a probe sweeping to a
// reading). Source files: public/brand/sonda-*.svg. Two tones:
//   - "mono"  → strokes in currentColor. The default; sits on any light
//               surface and takes the surrounding text/accent color.
//   - "color" → the two-tone version tuned for the dark ground (login's
//               left panel, the favicon).
// Colors are otherwise design tokens (theme/tokens.css), never here.
import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

export const BRAND = {
  /** Product name as written in sentences: "Everything {name} learns…". */
  name: "Sonda",
  /** The wordmark as set in the UI: lowercase, medium weight, tight. */
  wordmark: "sonda",
  /** One line under the mark on the login screen. */
  tagline: "Know the car before you touch it.",
} as const;

// The mark's own palette (from the source SVGs). Brand-owned, not UI
// tokens: it does not follow the accent if the accent changes.
const MARK = {
  arc: "#9184d9",
  arcShadow: "#423a6a",
  dot: "#e7e5fe",
} as const;

export function BrandMark({
  size = 20,
  tone = "mono",
  className,
  ...rest
}: { size?: number; tone?: "mono" | "color" } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      strokeLinecap="round"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...rest}
    >
      {tone === "color" ? (
        <>
          <path d="M18.8 63.2 A30 30 0 1 1 61.2 63.2" stroke={MARK.arc} strokeWidth="12" />
          <path d="M61.2 63.2 A30 30 0 0 1 18.8 63.2" stroke={MARK.arcShadow} strokeWidth="12" />
          <circle cx="61.2" cy="63.2" r="8" fill={MARK.dot} />
        </>
      ) : (
        <>
          <path d="M18.8 63.2 A30 30 0 1 1 61.2 63.2" stroke="currentColor" strokeWidth="12" />
          <circle cx="61.2" cy="63.2" r="8" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/** Mark + wordmark, the lockup used in the sidebar and on the gates. */
export function Wordmark({
  size = "md",
  tone = "mono",
  className,
  markClassName,
}: {
  size?: "sm" | "md" | "lg";
  tone?: "mono" | "color";
  className?: string;
  markClassName?: string;
}) {
  const text = { sm: "text-[15px]", md: "text-[17px]", lg: "text-[19px]" }[size];
  const mark = { sm: 18, md: 20, lg: 22 }[size];
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark size={mark} tone={tone} className={markClassName} />
      <span className={cn("font-heading font-medium leading-none tracking-[-0.025em]", text)}>{BRAND.wordmark}</span>
    </span>
  );
}
