import { groupBySystem } from "@/lib/dtc-grouping";
import { CodeGroupRow } from "@/views/diagnose/CodeGroupRow";

export function CodeStatusSection({
  label,
  codes,
  affected,
  onSelect,
}: {
  label: string;
  codes: string[];
  affected: ReadonlySet<string>;
  onSelect: (code: string) => void;
}) {
  if (codes.length === 0) return null;
  const groups = groupBySystem(codes);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">
        {label} ({codes.length})
      </span>
      <div className="flex flex-col gap-2 pl-1">
        {groups.map((group) => (
          <CodeGroupRow key={group.system} group={group} affected={affected} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
