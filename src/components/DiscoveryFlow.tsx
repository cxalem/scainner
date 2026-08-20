// First-connect onboarding: shown once, the first time a VIN Scainner has
// never seen before finishes connecting. Walks through the same steps the
// backend actually performs — VIN/identity read, then a full sensor sweep +
// fault-code check — rather than a canned animation, so what's shown here is
// always true of the car that just connected.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@/lib/tauri";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { VehicleScene } from "@/components/VehicleScene";
import type { DtcResult, EcuInfo, SensorReading } from "@/lib/meta";

type Step = "discovering" | "scanning" | "results";

function Row({
  label,
  value,
  pending,
}: {
  label: string;
  value: string | null;
  pending: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Reading…" />
      ) : (
        <span className="font-mono">{value ?? "—"}</span>
      )}
    </div>
  );
}

export function DiscoveryFlow({ vin, onDone }: { vin: string; onDone: () => void }) {
  const [step, setStep] = useState<Step>("discovering");
  const [ecu, setEcu] = useState<EcuInfo | null>(null);
  const [sensors, setSensors] = useState<SensorReading[] | null>(null);
  const [scan, setScan] = useState<DtcResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const info = await invoke<EcuInfo>("read_ecu_info").catch(() => null);
        setEcu(info);
        await new Promise((r) => setTimeout(r, 700)); // let identity land before the sweep starts
        setStep("scanning");

        const [sensorList, dtc] = await Promise.all([
          invoke<SensorReading[]>("all_sensors").catch(() => [] as SensorReading[]),
          invoke<DtcResult>("scan_dtcs").catch(() => null),
        ]);
        setSensors(sensorList);
        setScan(dtc);
        setStep("results");
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const sceneStatus = step === "results" ? "connected" : "connecting";
  const dtcCount = scan ? scan.stored.length + scan.pending.length : null;

  return (
    // m-auto on the child, not items-center on the parent: flex centering of
    // content taller than a scroll container pushes the overflow above the
    // top edge where it cannot be scrolled to (the 3D card showed up
    // beheaded on laptop-height windows). Auto margins center when there is
    // room and degrade to normal scrolling when there is not.
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-background p-6">
      <div className="m-auto flex w-full max-w-lg flex-col gap-5 py-8">
        <VehicleScene status={sceneStatus} vin={vin} />

        <div className="text-center">
          <Badge variant="muted" className="mb-2">
            New vehicle
          </Badge>
          <h1 className="text-lg font-semibold tracking-tight" aria-live="polite">
            {step === "discovering" && "Discovering your vehicle…"}
            {step === "scanning" && "Reading every sensor it has…"}
            {step === "results" && "Here's what we found"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === "discovering" && "Confirming identity and protocol."}
            {step === "scanning" && "This can take up to 20 seconds on real hardware."}
            {step === "results" && "Recording starts automatically from here."}
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <Card>
          <CardContent className="flex flex-col gap-2.5 pt-4">
            <Row label="VIN" value={vin} pending={false} />
            <Row label="Protocol" value={ecu?.protocol ?? null} pending={step === "discovering" && !ecu} />
            <Row label="ELM version" value={ecu?.elm_version ?? null} pending={step === "discovering" && !ecu} />
            <Row
              label="Sensors found"
              value={sensors ? String(sensors.length) : null}
              pending={step !== "results" && sensors == null}
            />
            <Row
              label="Fault codes"
              value={scan ? (dtcCount === 0 ? "none — clean" : `${dtcCount} found`) : null}
              pending={step !== "results" && scan == null}
            />
          </CardContent>
        </Card>

        {step === "results" && sensors && sensors.length > 0 && (
          <Card>
            <CardContent className="max-h-52 overflow-y-auto pt-4">
              <table className="w-full text-sm">
                <tbody>
                  {sensors.map((s) => (
                    <tr key={s.pid} className="border-b border-border/50 last:border-0">
                      <td className="py-1 text-muted-foreground">{s.label}</td>
                      <td className="py-1 text-right font-mono tabular-nums">
                        {s.value.toFixed(1)} <span className="text-xs text-muted-foreground">{s.unit}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {(step === "results" || error) && (
          <Button onClick={onDone} className="self-center">
            Go to dashboard <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
