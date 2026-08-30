import { Eraser } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { useT } from "@/i18n";

// The one confirmation pattern every write action goes through. Part 1 of
// the write-caps hard rule (confirmation + logged before/after + documented
// reversal path). The dialog always states what will change, on which
// module, and whether it can be undone; `reversal` is required on purpose.
// Overlay, never inline, so confirming never shifts the layout.
//
// The backend refuses writes without `confirmed: true`; the confirm button
// here is the only place the frontend sets that flag.
export function ConfirmWrite({
  open = true,
  title,
  module,
  whatChanges,
  reversal,
  confirmLabel,
  busy,
  busyLabel,
  cancelLabel,
  nowLine,
  afterLine,
  onConfirm,
  onCancel,
}: {
  open?: boolean;
  title: string;
  module: string;
  whatChanges: string;
  reversal: string;
  confirmLabel: string;
  busy?: boolean;
  busyLabel?: string;
  cancelLabel?: string;
  /** Optional Now / After summary box (what the car reports before and
   *  what it will report after). */
  nowLine?: string;
  afterLine?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={title}
      icon={Eraser}
      iconTone="warn"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t.common.cancel}
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm} busy={busy}>
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-[1.6] text-neutral-400">
        <span className="text-text">{module}: </span>
        {whatChanges}
      </p>
      {(nowLine || afterLine) && (
        <div className="flex flex-col gap-1.5 rounded-sm bg-bg px-[13px] py-[11px] text-[13px]">
          {nowLine && (
            <span className="flex gap-2">
              <span className="w-[52px] shrink-0 text-neutral-500">{t.diagnose.v2.clear.now}</span>
              <span>{nowLine}</span>
            </span>
          )}
          {afterLine && (
            <span className="flex gap-2">
              <span className="w-[52px] shrink-0 text-neutral-500">{t.diagnose.v2.clear.after}</span>
              <span>{afterLine}</span>
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1 text-[12px] leading-[1.55] text-neutral-500">
        <span className="text-neutral-400">{t.confirmWrite.canThisBeUndone}</span>
        <span>{reversal}</span>
        <span>{t.confirmWrite.savedToHistory}</span>
      </div>
    </Dialog>
  );
}
