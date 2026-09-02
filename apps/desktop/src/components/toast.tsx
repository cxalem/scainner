// The app's toast API — a thin wrapper over sonner (components/ui/sonner.tsx).
//
//   toast.success("Paired OBD Reader 4821")
//   toast.error(t.gate.failure.noAdapter, {
//     description: t.gate.failureHints.checkPlug,
//     action: { label: t.gate.tryAgain, onClick: retry },
//     secondaryAction: { label: t.gate.chooseAnotherDevice, onClick: rescan },
//     details: "Open: no such device",
//   })
//
// Sonner owns everything a queue owns: the stack, the three-visible limit,
// promoting queued toasts as those on screen leave, pausing the countdown
// under the pointer and under focus, the swipe, the exit animation. This
// file owns the app's side of it — the variants, the body layout, the
// Details disclosure, and the per-variant dwell times in lib/toast.ts.
//
// Why a wrapper at all rather than importing sonner at the call sites: the
// Details disclosure is the whole reason the hand-made toast existed (a
// transport error one click away for a support screenshot, never the first
// thing read), and it has to re-issue the toast to stop the countdown while
// it is open. That belongs in one place, not in every caller.
import { useCallback, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { toast as sonner } from "sonner";
import { Button, ExpanderButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { toastDuration, toastRole, type ToastVariant } from "@/lib/toast";

export type { ToastVariant } from "@/lib/toast";

export type ToastAction = {
  label: string;
  onClick: () => void;
  /** Offered but not available yet — the button stays visible so the toast
   *  does not change shape, the way it does inline. */
  disabled?: boolean;
};

export type ToastOptions = {
  /** The secondary line: what to do about it, when there is something. */
  description?: string;
  /** The recovery the toast is really offering. */
  action?: ToastAction;
  /** The other way out, when there are two. */
  secondaryAction?: ToastAction;
  /** Raw technical text, hidden behind the Details disclosure. */
  details?: string | null;
  /** The disclosure's own label — required whenever `details` is set, so
   *  the toast never grows an English-only control. */
  detailsLabel?: string;
  /** Overrides the variant's default dwell time. */
  durationMs?: number;
  /** Stays up until it is dismissed. */
  sticky?: boolean;
  /** Reuse an id to replace a toast in place instead of stacking a second
   *  copy of the same news. */
  id?: string | number;
};

type ToastId = string | number;

let seq = 0;
/** Ours, not sonner's, because the body needs the id before the toast that
 *  carries it exists — Escape dismisses by id, and so does re-issuing the
 *  toast when Details opens. */
const nextToastId = (): ToastId => `sonda-toast-${++seq}`;

/** One toast's body: the hint line, the recovery actions, and the details
 *  disclosure. Rendered into sonner's description slot so the variant icon,
 *  border tone and close button stay sonner's. */
function ToastBody({
  id,
  variant,
  options,
  detailsOpen,
  onToggleDetails,
}: {
  id: ToastId;
  variant: ToastVariant;
  options: ToastOptions;
  detailsOpen: boolean;
  onToggleDetails: (open: boolean) => void;
}) {
  const { description, action, secondaryAction, details, detailsLabel } = options;
  const hasActions = action != null || secondaryAction != null;
  const hasDetails = details != null && details !== "" && detailsLabel != null;

  return (
    <div
      // The rail is one polite live region for every toast in it, so a
      // variant that must interrupt says so here — see toastRole().
      role={toastRole(variant)}
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        // Escape closes the one the user is actually in. The rail is not
        // in the tab order until something inside it takes focus, so this
        // never competes with a dialog's own Escape.
        if (e.key === "Escape") {
          e.stopPropagation();
          sonner.dismiss(id);
        }
      }}
    >
      {description && <span className="block">{description}</span>}

      {(hasActions || hasDetails) && (
        <div className="flex flex-wrap items-center gap-2">
          {action && (
            <Button variant="primary" size="sm" disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="ghost"
              size="sm"
              disabled={secondaryAction.disabled}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
          {hasDetails && (
            <ExpanderButton
              open={detailsOpen}
              onClick={() => onToggleDetails(!detailsOpen)}
              className="ml-auto text-[11.5px]"
            >
              {detailsLabel}
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-150 motion-reduce:transition-none",
                  detailsOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </ExpanderButton>
          )}
        </div>
      )}

      {hasDetails && detailsOpen && (
        <p className="num break-words border-t border-divider pt-2 text-[11px] leading-snug text-neutral-500">
          {details}
        </p>
      )}
    </div>
  );
}

/** Raise a toast, or replace the one already carrying this `id`.
 *
 *  Opening Details re-issues the same toast with an infinite duration: it
 *  is the one honest way to stop sonner's countdown, which has no pause of
 *  its own beyond hover and focus, and a reader who has just asked for the
 *  technical text should not lose it three seconds later. */
function raise(variant: ToastVariant, title: string, options: ToastOptions = {}): ToastId {
  const id = options.id ?? nextToastId();

  // A toast with nothing under its title — "Paired X" — gets no body at
  // all, rather than an empty box holding the description slot open. The
  // exception is the variants that must interrupt: they carry the body
  // purely for its role (see toastRole).
  const hasBody =
    options.description != null ||
    options.action != null ||
    options.secondaryAction != null ||
    (options.details != null && options.details !== "");

  const emit = (detailsOpen: boolean) =>
    sonner[variant](title, {
      id,
      duration: toastDuration(variant, { ...options, detailsOpen }),
      closeButton: true,
      description:
        hasBody || toastRole(variant) === "alert" ? (
          <ToastBody
            id={id}
            variant={variant}
            options={options}
            detailsOpen={detailsOpen}
            onToggleDetails={(open) => emit(open)}
          />
        ) : undefined,
    });

  return emit(false);
}

function dismiss(id?: ToastId) {
  sonner.dismiss(id);
}

/** The module-level API, for the places that raise a toast outside a React
 *  render (an event handler in a plain module, a service callback). */
export const toast = {
  success: (title: string, options?: ToastOptions) => raise("success", title, options),
  info: (title: string, options?: ToastOptions) => raise("info", title, options),
  warning: (title: string, options?: ToastOptions) => raise("warning", title, options),
  error: (title: string, options?: ToastOptions) => raise("error", title, options),
  dismiss,
};

/** The same API from inside a component, with stable identities so it can
 *  sit in a dependency array without re-running the effect that uses it. */
export function useToast() {
  const show = useCallback(
    (variant: ToastVariant, title: string, options?: ToastOptions) => raise(variant, title, options),
    [],
  );
  const hide = useCallback((id?: ToastId) => dismiss(id), []);
  return useMemo(() => ({ show, dismiss: hide }), [show, hide]);
}
