
export type ToastVariant = "success" | "info" | "warning" | "error";

export const TOAST_DURATION_MS: Record<ToastVariant, number> = {
  success: 4000,
  info: 6000,
  warning: 6000,
  error: 8000,
};

export type ToastDurationInput = {
  durationMs?: number;
  sticky?: boolean;
  detailsOpen?: boolean;
};

export function toastDuration(variant: ToastVariant, input: ToastDurationInput = {}): number {
  if (input.sticky || input.detailsOpen) return Number.POSITIVE_INFINITY;
  if (input.durationMs != null) {
    return input.durationMs > 0 ? input.durationMs : Number.POSITIVE_INFINITY;
  }
  return TOAST_DURATION_MS[variant];
}

export function toastRole(variant: ToastVariant): "alert" | "status" {
  return variant === "error" || variant === "warning" ? "alert" : "status";
}
