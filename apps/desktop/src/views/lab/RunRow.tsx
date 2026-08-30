// The one run row every Lab mode shares: a primary button, a note about the
// preconditions, and whatever secondary controls the mode needs (stop,
// options). Lives in the flush card's header area, under the mode picker.
import type { ReactNode } from "react";
import { Play, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";

/** The header block's lower half: holds the RunRow under the mode picker. */
export function RunSection({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-b border-divider px-[17px] pb-[15px] pt-[13px]">{children}</div>;
}

export function RunRow({
  label,
  onRun,
  busy = false,
  disabled = false,
  note,
  icon = Play,
  children,
}: {
  label: string;
  onRun: () => void;
  busy?: boolean;
  disabled?: boolean;
  note: ReactNode;
  icon?: LucideIcon;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" icon={icon} busy={busy} disabled={disabled} onClick={onRun}>
        {label}
      </Button>
      {children}
      <span className="text-[12px] text-neutral-500">{note}</span>
    </div>
  );
}

/** A plan/target row: mono address, name, mono detail, optional trailing. */
export function TargetRow({
  addr,
  name,
  detail,
  trailing,
}: {
  addr: string;
  name: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-[11px] text-[12.5px]">
      {/* min-w, not w: a fixed width clips nothing (no overflow-hidden) but
          still lets a longer real address (e.g. extended "6A8/688" module
          routing, vs. the design's 2-char "01"/"44") paint straight over
          the name column instead of pushing it right. min-w keeps short
          addresses aligned and lets long ones grow safely. */}
      <span className="num min-w-[26px] shrink-0 text-neutral-500">{addr}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {detail && <span className="num text-[11.5px] text-neutral-500">{detail}</span>}
      {trailing && <span className="text-[11.5px] text-neutral-500">{trailing}</span>}
    </div>
  );
}
