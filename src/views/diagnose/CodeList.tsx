import { CodeBadge } from "@/views/diagnose/CodeBadge";

export function CodeList({ label, codes, onSelect }: { label: string; codes: string[]; onSelect: (c: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 text-muted-foreground">{label}</span>
      {codes.length === 0 ? (
        <span className="text-muted-foreground">none</span>
      ) : (
        codes.map((c) => <CodeBadge key={c} code={c} onSelect={onSelect} />)
      )}
    </div>
  );
}
