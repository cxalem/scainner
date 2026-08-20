import { AlertTriangle } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

// The one confirmation pattern every write action goes through. This is part
// 1 of the write-caps hard rule (confirmation + logged before/after +
// documented reversal path). The modal always states what will change, on
// which module, and whether it can be undone. The `reversal` text is
// required on purpose: a write whose reversal story nobody wrote down does
// not ship. Overlay modal, never an inline banner, so confirming a write
// never shifts the layout (design principle: no layout shifts).
//
// The backend refuses writes without `confirmed: true`; the confirm button
// here is the only place the frontend sets that flag.
export function ConfirmWrite({
  title,
  module,
  whatChanges,
  reversal,
  confirmLabel,
  busy,
  busyLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  module: string;
  whatChanges: string;
  reversal: string;
  confirmLabel: string;
  busy?: boolean;
  // What the confirm button says while busy — every pending write action
  // gets a visible label change, not just a disabled button (app-perf's
  // interaction-feedback standard). Falls back to confirmLabel if omitted,
  // so existing callers don't break, but every real write should pass one.
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex overflow-y-auto bg-foreground/30 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <Card className="m-auto w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" /> {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            <span className="font-medium">{module}: </span>
            {whatChanges}
          </p>
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="mb-1 font-medium">Can this be undone?</p>
            <p className="text-muted-foreground">{reversal}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            The state before and after this change is saved to the write history.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="destructive" onClick={onConfirm} disabled={busy}>
              {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
