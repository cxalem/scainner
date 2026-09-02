// The rules a toast follows, kept out of the React wrapper so they are
// testable and so there is one place that answers "how long does this stay
// up, and how loudly is it announced".
//
// The queue itself is not here on purpose: sonner owns the stack, the
// three-visible limit, the promotion of queued toasts and the pause on
// hover/focus (components/ui/sonner.tsx). What is ours is the app's policy
// on top of it — the per-variant dwell time, what `sticky` means, and which
// variants are urgent enough to interrupt a screen reader.

export type ToastVariant = "success" | "info" | "warning" | "error";

/**
 * How long each variant stays up with nobody touching it.
 *
 * The scale is "how much does the reader have to do about it": a success is
 * a receipt and can leave quickly, an error usually carries actions and a
 * Details disclosure, so it gets twice as long to be read and reached.
 */
export const TOAST_DURATION_MS: Record<ToastVariant, number> = {
  success: 4000,
  info: 6000,
  warning: 6000,
  error: 8000,
};

export type ToastDurationInput = {
  /** Overrides the variant default. */
  durationMs?: number;
  /** Stays until it is dismissed — for a message the user must act on. */
  sticky?: boolean;
  /** The Details disclosure is open: the countdown stops, because the
   *  reader is mid-way through the one thing the toast was hiding. */
  detailsOpen?: boolean;
};

/**
 * The dwell time for one toast. `sticky` and an open Details both mean
 * "wait for me" and win over any explicit duration; otherwise an explicit
 * `durationMs` wins over the variant default. A non-positive duration is
 * treated as sticky rather than as "dismiss instantly", which is what a
 * caller passing 0 always means.
 */
export function toastDuration(variant: ToastVariant, input: ToastDurationInput = {}): number {
  if (input.sticky || input.detailsOpen) return Number.POSITIVE_INFINITY;
  if (input.durationMs != null) {
    return input.durationMs > 0 ? input.durationMs : Number.POSITIVE_INFINITY;
  }
  return TOAST_DURATION_MS[variant];
}

/**
 * How the message is announced. Sonner's rail is one `aria-live="polite"`
 * region for everything in it, so a variant that must interrupt carries
 * `role="alert"` on its own body instead — the only per-toast lever there
 * is. Success and info stay polite: they report something the user just
 * did and have no business cutting into whatever is being read.
 */
export function toastRole(variant: ToastVariant): "alert" | "status" {
  return variant === "error" || variant === "warning" ? "alert" : "status";
}
