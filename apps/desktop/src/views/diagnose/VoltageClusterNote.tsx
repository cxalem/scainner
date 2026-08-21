import { Zap } from "lucide-react";
import { detectVoltageCluster } from "@/lib/dtc-grouping";

// The one clustering hint this app makes: an honest, inspectable note, not a
// hidden reclassification. Renders nothing when nothing qualifies — see
// docs/workflows/diagnose-ux/plan.md for the exact trigger rule and why it's
// deliberately narrow (only codes with a real, direct voltage mechanism).
export function VoltageClusterNote({
  scan,
}: {
  scan: { stored: string[]; pending: string[]; permanent: string[]; voltage?: number | null };
}) {
  const cluster = detectVoltageCluster(scan);
  if (!cluster) return null;

  return (
    <div className="flex items-start gap-1.5 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{cluster.note} Marked with ⚡ below. Every code is still shown on its own, click any of them for details.</span>
    </div>
  );
}
