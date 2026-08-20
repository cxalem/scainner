import { Badge } from "@/components/ui";

// Every code badge in this view is a button into the per-code detail modal.
export function CodeBadge({ code, onSelect }: { code: string; onSelect: (c: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(code)}
      className="rounded-full transition-transform hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2"
      aria-label={`Details for ${code}`}
    >
      <Badge variant="error" className="cursor-pointer font-mono underline-offset-2 hover:underline">
        {code}
      </Badge>
    </button>
  );
}
