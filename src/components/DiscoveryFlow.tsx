// First-connect onboarding: shown once, the first time a VIN Scainner has
// never seen before finishes connecting. Walks through the same steps the
// backend actually performs — VIN/identity read, then a full sensor sweep +
// fault-code check — rather than a canned animation, so what's shown here is
// always true of the car that just connected.
import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@/core/services/device-service";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { VehicleScene } from "@/components/VehicleScene";
import type { DtcResult, EcuInfo, SensorReading } from "@/lib/meta";
import { brandFromVin } from "@/lib/brand";
import { decodeModelYear } from "@/lib/vin";

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
    runPromise(
      Effect.gen(function* () {
        const s = yield* DeviceService;
        const info = yield* s.readEcuInfo().pipe(Effect.catchAll(() => Effect.succeed(null)));
        setEcu(info);
        yield* Effect.sleep("700 millis"); // let identity land before the sweep starts
        setStep("scanning");

        // Effect.all with concurrency: "unbounded" runs both requests in
        // parallel, same as the Promise.all it replaces.
        const [sensorList, dtc] = yield* Effect.all(
          [
            s.allSensors().pipe(Effect.catchAll(() => Effect.succeed([]))),
            s.scanDtcs().pipe(Effect.catchAll(() => Effect.succeed(null))),
          ],
          { concurrency: "unbounded" },
        );
        setSensors(sensorList);
        setScan(dtc);
        setStep("results");
      }),
    ).catch((e) => setError(String(e)));
  }, []);

  const sceneStatus = step === "results" ? "connected" : "connecting";
  const dtcCount = scan ? scan.stored.length + scan.pending.length : null;
  // Both decode straight from the VIN, no round trip needed — same brand
  // lookup the emblem itself uses, plus the model year (see lib/vin.ts for
  // why that stops at year and doesn't reach for the exact model/trim).
  const brand = brandFromVin(vin);
  const modelYear = decodeModelYear(vin);

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
            <Row
              label="Vehicle"
              value={brand ? `${brand.name}${modelYear ? `, ${modelYear}` : ""}` : "Unrecognized brand"}
              pending={false}
            />
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
            {/* overflow-y-scroll (not -auto): the scrollbar's gutter stays
                reserved whether or not the content actually overflows, so
                it doesn't appear the instant this list grows past max-h-52
                and shove everything a few pixels left — the same
                layout-shift bug class the connect flow already got fixed
                for elsewhere, just a different trigger. */}
            <CardContent className="max-h-52 overflow-y-scroll pt-4">
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
