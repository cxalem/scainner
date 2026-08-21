import { CheckCircle2 } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle, useCyclingLabel } from "@/components/ui";
import type { DtcResult } from "@scainner/core";
import { detectVoltageCluster } from "@/lib/dtc-grouping";
import { CodeStatusSection } from "@/views/diagnose/CodeStatusSection";
import { VoltageClusterNote } from "@/views/diagnose/VoltageClusterNote";
import { FreezeFrame } from "@/views/diagnose/FreezeFrame";

// Cycled while a scan is running — same "long wait reads as moving forward"
// idiom useCyclingLabel already established elsewhere in this app, not a new
// pattern. Order roughly matches what the backend command actually does.
const SCANNING_PHRASES = ["Reading trouble codes…", "Checking readiness monitors…", "Pulling freeze frame data…"];

// Always mounted at the same position with the same header — this is the
// fix for the layout-shift complaint (2026-08-21, Alejandro): the old
// "Latest scan" card only existed in the tree once a scan landed, so its
// arrival pushed every card below it down the page. Now the state changes
// INSIDE this card (idle → scanning → results) instead of the card itself
// appearing and disappearing, matching engineering.md rule 5 ("swap in
// place"). The scan-sweep bar and cycling label give the "the device is
// actively scanning this car" feel Alejandro asked for, instead of just the
// button's spinner. Results fade/slide in (see .animate-fade-slide-in in
// index.css) so the one remaining height change — idle's one line growing
// into a full result list — is an animated transition, not a jump.
export function FaultCodesPanel({
  scanning,
  scan,
  onSelect,
}: {
  scanning: boolean;
  scan: DtcResult | null;
  onSelect: (code: string) => void;
}) {
  const cyclingLabel = useCyclingLabel(SCANNING_PHRASES, scanning);
  const totalCodes = scan ? scan.stored.length + scan.pending.length + scan.permanent.length : 0;
  const voltageAffected = new Set(scan ? (detectVoltageCluster(scan)?.affected ?? []) : []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fault codes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {scanning ? (
          <div className="flex flex-col gap-2 py-1.5">
            <div className="relative h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 w-1/3 animate-[scan-sweep_1.4s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:animate-none"
                aria-hidden="true"
              />
            </div>
            <p className="text-sm text-muted-foreground">{cyclingLabel}</p>
          </div>
        ) : !scan ? (
          <p className="text-sm text-muted-foreground">No scan yet. Click "Scan for codes" to check this vehicle.</p>
        ) : (
          <div className="animate-fade-slide-in flex flex-col gap-3">
            <div className="flex items-center gap-2">
              {scan.mil_on ? (
                <Badge variant="error">CHECK ENGINE ON · {scan.dtc_count} codes</Badge>
              ) : (
                <Badge variant="ok">
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> MIL off
                </Badge>
              )}
              {scan.voltage != null && <Badge variant="muted">{scan.voltage.toFixed(1)} V</Badge>}
            </div>
            <VoltageClusterNote scan={scan} />
            <CodeStatusSection label="Stored" codes={scan.stored} affected={voltageAffected} onSelect={onSelect} />
            <CodeStatusSection label="Pending" codes={scan.pending} affected={voltageAffected} onSelect={onSelect} />
            <CodeStatusSection
              label="Permanent"
              codes={scan.permanent}
              affected={voltageAffected}
              onSelect={onSelect}
            />
            {totalCodes === 0 && <p className="text-sm text-muted-foreground">No codes on this scan.</p>}
            <p className="text-xs text-muted-foreground">Click any code for details, its history, and an AI deep-dive.</p>
            {scan.freeze && <FreezeFrame data={scan.freeze as Record<string, unknown>} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
