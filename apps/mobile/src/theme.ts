// Mobile translation of the "calm instrument" design system (brand.md).
// The desktop app defines these tokens as oklch CSS custom properties in
// apps/desktop/src/index.css; React Native has no oklch() support, so each
// value here is the exact sRGB hex conversion of the light-mode token.
// Single-theme on purpose — same decision as desktop (index.css: "one light
// palette, no dark variant").
import { Platform, type TextStyle } from "react-native";

export const colors = {
  background: "#fafaf9", // oklch(0.985 0.002 90)
  foreground: "#13161b", // oklch(0.2 0.01 260)
  card: "#ffffff", // oklch(1 0 0)
  muted: "#f1f0ed", // oklch(0.955 0.004 90)
  mutedForeground: "#5e646c", // oklch(0.5 0.015 260)
  border: "#e3e1dd", // oklch(0.91 0.006 90)
  primary: "#008e3e", // oklch(0.55 0.18 155) — the single green accent
  primaryForeground: "#fcfcfc", // oklch(0.99 0 0)
  destructive: "#cc2827", // oklch(0.55 0.2 27)
  warn: "#da950b", // oklch(0.72 0.15 75)
} as const;

// Tints for badges/pills: the token color at low opacity over white, so
// semantic colors stay meaningful without shouting (green good, amber
// watch, red attention — never decorative).
export const tints = {
  primary: "#e6f4ec",
  destructive: "#faeaea",
  warn: "#fbf4e7",
  muted: colors.muted,
} as const;

// 4px spacing grid, same as desktop's layout system.
export const space = (n: number) => n * 4;

// Type scale: text-sm default, text-xs secondary, nothing below 12px.
export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 20,
  xl: 28,
} as const;

// --radius: 0.625rem (10px) with the same -2/-4 steps as the desktop theme.
export const radius = {
  lg: 10,
  md: 8,
  sm: 6,
} as const;

// "Numbers: monospace + tabular-nums, always" — every sensor value,
// voltage, code, VIN. This is the app's strongest visual signature, so it
// ships as one reusable style object.
export const monoFamily = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, monospace",
}) as string;

export const mono: TextStyle = {
  fontFamily: monoFamily,
  fontVariant: ["tabular-nums"],
};

// One stroke width throughout; 16px icons beside text-sm.
export const icon = {
  sm: 16,
  md: 20,
  strokeWidth: 2,
} as const;
