import { useEffect } from "react";
import { Radar } from "lucide-react";
import type { DiscoveryStatus } from "@scainner/core";
import { Button, Card, Note, ProgressBar } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Reveal } from "@/motion/components";
import { useRunDiscovery } from "@/features/lab/queries";
import { discoveryPercent } from "@/lib/discovery-notice";
import { useLocale, useT } from "@/i18n";

function formatWhen(stamp: string, locale: string): string {
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return stamp;
  return d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AutoScanState({
  vehicleId,
  discovery = null,
}: {
  vehicleId: number | null;
  discovery?: DiscoveryStatus | null;
}) {
  const t = useT();
  const toast = useToast();
  const { locale } = useLocale();
  const a = t.autoScan.lab;
  const scanAgain = useRunDiscovery();
  const running = discovery?.state === "running";

  const line = (() => {
    if (!discovery) return a.unknownLine;
    switch (discovery.state) {
      case "running":
        return a.runningLine(a.stages[discovery.stage ?? "census"]);
      case "skipped":
        return a.skippedLine(discovery.last_run_at ? formatWhen(discovery.last_run_at, locale) : "—");
      case "done":
        return a.doneLine(discovery.last_run_at ? formatWhen(discovery.last_run_at, locale) : "—");
      default:
        return a.idleLine;
    }
  })();

  const queued = scanAgain.data != null && !scanAgain.data.triggered;

  useEffect(() => {
    if (queued) toast.show("info", a.queued);
  }, [queued, a.queued, toast]);

  return (
    <Card className="gap-2.5">
      <div className="flex items-start gap-2.5">
        <Radar className="mt-[3px] h-4 w-4 shrink-0 text-accent-600" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-[13.5px]">{a.title}</span>
          <span className="text-[12.5px] leading-[1.55] text-neutral-400">{line}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          busy={scanAgain.isPending || running}
          disabled={vehicleId == null || scanAgain.isPending || running}
          onClick={() => vehicleId != null && scanAgain.mutate({ vehicleId })}
        >
          {scanAgain.isPending || running ? a.scanning : a.scanAgain}
        </Button>
      </div>
      <Reveal when={running} mode="fade">
        <ProgressBar value={discoveryPercent(discovery)} height={2} />
      </Reveal>
      <Note className="text-[11.5px]">{a.explainer}</Note>
      <Reveal when={scanAgain.isError} mode="fade">
        <p className="text-[12px] text-stop">{a.failed}</p>
      </Reveal>
    </Card>
  );
}
