import type { ReactNode } from "react";
import { Play, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";

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
      <span className="num min-w-[26px] shrink-0 text-neutral-500">{addr}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {detail && <span className="num text-[11.5px] text-neutral-500">{detail}</span>}
      {trailing && <span className="text-[11.5px] text-neutral-500">{trailing}</span>}
    </div>
  );
}
