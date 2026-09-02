import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

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
      className={className}
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
          <path d="M61.2 63.2 A30 30 0 0 1 18.8 63.2" stroke="currentColor" strokeWidth="12" opacity="0.55" />
          <circle cx="61.2" cy="63.2" r="8" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function Wordmark({
  size = 20,
  tone = "mono",
  markClassName,
  textClassName,
}: {
  size?: number;
  tone?: "mono" | "color";
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={size} tone={tone} className={markClassName} />
      <span className={cn("font-medium tracking-[-0.025em]", textClassName)}>sonda</span>
    </span>
  );
}
