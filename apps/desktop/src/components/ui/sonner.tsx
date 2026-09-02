// shadcn/ui — Sonner's <Toaster>, as installed by `shadcn add sonner`, with
// three edits this app needs:
//
//  1. no next-themes. The app is single-theme light on purpose (main.tsx),
//     so the theme is pinned instead of read from a provider that does not
//     exist here.
//  2. the icons are the kit's lucide set at the kit's 16 px, each in the
//     token that carries its meaning (ok / warn / stop / accent).
//  3. the toast surface is drawn from the Sonda roles mapped in index.css,
//     so a toast is the same white card, divider, radius and elevation as
//     everything else on screen.
//
// The rail sits bottom centre — where the hand-made toast it replaces sat,
// over the layout, nothing under it moving — and shows at most three at a
// time, newest nearest the edge they arrive from. Sonner pauses its own
// timers on hover and on focus, and takes the toast list out of the tab
// order until then, which is why the app no longer owns any of that.
import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonX } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** How many are on screen at once; sonner queues the rest and promotes them
 *  as those leave. */
export const TOAST_VISIBLE_LIMIT = 3;

function Toaster({
  closeLabel,
  toastOptions,
  ...props
}: ToasterProps & {
  /** The close button's accessible name, in the reader's language. */
  closeLabel?: string;
}) {
  return (
    <Sonner
      theme="light"
      position="bottom-center"
      visibleToasts={TOAST_VISIBLE_LIMIT}
      // Off deliberately: sonner's rich colours are its own palette. The
      // variant's tone comes from the kit's ok/warn/stop tokens below.
      richColors={false}
      className="toaster group"
      icons={{
        success: <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden="true" />,
        info: <Info className="h-4 w-4 text-accent-400" aria-hidden="true" />,
        warning: <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />,
        error: <OctagonX className="h-4 w-4 text-stop" aria-hidden="true" />,
        loading: <Loader2 className="h-4 w-4 animate-spin text-neutral-500" aria-hidden="true" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-md)",
          "--width": "420px",
          // The close button belongs inside the card's top-right corner,
          // where the kit has always put a dismiss. Sonner's default hangs
          // it off the top-LEFT edge, half outside the border.
          "--toast-close-button-start": "unset",
          "--toast-close-button-end": "0",
          "--toast-close-button-transform": "translate(-55%, 55%)",
        } as React.CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: closeLabel,
        ...toastOptions,
        classNames: {
          // items-start: the icon sits on the title's line, not centred
          // against a body that can be four lines tall.
          toast: "cn-toast !items-start !bg-surface !text-text !border !border-divider !shadow-lg",
          icon: "!mt-px",
          closeButton:
            "!border-divider !bg-surface !text-neutral-500 hover:!bg-neutral-900 hover:!text-text",
          title: "!text-[13px] !leading-snug !text-text",
          description: "!text-[12px] !leading-snug !text-neutral-500",
          // The tone lives in the left border, the way the kit's Note and
          // Banner carry it — colour means something here, it never
          // decorates.
          success: "!border-ok-line",
          warning: "!border-warn-line",
          error: "!border-stop-line",
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
