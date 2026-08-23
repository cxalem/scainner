// First-connect onboarding: shown once, the first time a VIN Scainner has
// never seen before finishes connecting. Walks through the same steps the
// backend actually performs — VIN/identity read, then a full sensor sweep +
// fault-code check — rather than a canned animation, so what's shown here is
// always true of the car that just connected.
import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import { VehicleScene } from "@/components/VehicleScene";
import type { DtcResult } from "@scainner/core";
import type { EcuInfo } from "@scainner/core";
import { brandFromVin } from "@/lib/brand";
import { decodeModelYear } from "@/lib/vin";
import { appearVariants, fadeTransition, staggerContainer, staggerItem } from "@/motion";
import { useT } from "@/i18n";

type Step = "discovering" | "scanning" | "results";

// Each field resolving crossfades from the spinner to its value instead of
// hard-cutting — this is the "field-by-field resolution appears suddenly"
// complaint (Alejandro, 2026-08-21), fixed per-row. `layout` lets the row
// smoothly absorb the width change between a spinner and a text value.
function Row({
  label,
  value,
  pending,
  readingAriaLabel,
}: {
  label: string;
  value: string | null;
  pending: boolean;
  readingAriaLabel: string;
}) {
  return (
    <motion.div variants={staggerItem} className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <AnimatePresence mode="wait" initial={false}>
        {pending ? (
          <motion.span
            key="pending"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fadeTransition}
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label={readingAriaLabel} />
          </motion.span>
        ) : (
          <motion.span
            key="value"
            className="font-mono"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={fadeTransition}
          >
            {value ?? "—"}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function DiscoveryFlow({ vin, onDone }: { vin: string; onDone: () => void }) {
  const t = useT();
  const [step, setStep] = useState<Step>("discovering");
  const [ecu, setEcu] = useState<EcuInfo | null>(null);
  const [scan, setScan] = useState<DtcResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runPromise(
      Effect.gen(function* () {
        const device = yield* DeviceService;
        const info = yield* device.readEcuInfo().pipe(Effect.catchAll(() => Effect.succeed(null)));
        setEcu(info);
        yield* Effect.sleep("700 millis"); // let identity land before the sweep starts
        setStep("scanning");

        // Do not run the expensive full sensor-catalog sweep here. That is
        // deliberately manual (Live → All sensors → Read all sensors), so
        // connecting never interrogates every supported PID behind the
        // user's back. The lightweight standing live gauges still record
        // normally once this flow finishes.
        const dtc = yield* device.scanDtcs().pipe(Effect.catchAll(() => Effect.succeed(null)));
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
      {/* No `layout` prop on this outer column on purpose: it was here
          originally, and it was wrong — giving the PARENT `layout` makes
          framer-motion track and interpolate the parent's own box size as
          children mount/unmount, which stretches everything inside
          (framer-motion scales child content to fill the box mid-animation
          unless every single child also independently tracks layout) —
          exactly the "everything above gets deformed too" Alejandro caught
          (2026-08-21). The fix is `layout="position"` on just the elements
          that actually need to slide to a new spot (below), not `layout`
          on their container. */}
      <div className="m-auto flex w-full max-w-lg flex-col gap-5 py-8">
        <VehicleScene status={sceneStatus} vin={vin} />

        <div className="text-center">
          <Badge variant="muted" className="mb-2">
            {t.discoveryFlow.newVehicle}
          </Badge>
          <h1 className="text-lg font-semibold tracking-tight" aria-live="polite">
            {step === "discovering" && t.discoveryFlow.step.discoveringTitle}
            {step === "scanning" && t.discoveryFlow.step.scanningTitle}
            {step === "results" && t.discoveryFlow.step.resultsTitle}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === "discovering" && t.discoveryFlow.step.discoveringSubtitle}
            {step === "scanning" && t.discoveryFlow.step.scanningSubtitle}
            {step === "results" && t.discoveryFlow.step.resultsSubtitle}
          </p>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              layout="position"
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={appearVariants}
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* layout="position" (not `layout`): this card's own size never
            changes, but it needs to slide, not deform, if the error banner
            above it mounts or unmounts. */}
        <motion.div layout="position">
          <Card>
            {/* staggerContainer/staggerItem: the six fields below resolve
                field by field as the backend actually finishes each read —
                staggering their reveal makes that sequence readable instead
                of every field just popping to its final state at once. */}
            <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
              <CardContent className="flex flex-col gap-2.5 pt-4">
                <Row
                  label={t.discoveryFlow.row.vehicle}
                  value={
                    brand
                      ? `${brand.name}${modelYear ? `, ${modelYear}` : ""}`
                      : t.discoveryFlow.row.unrecognizedBrand
                  }
                  pending={false}
                  readingAriaLabel={t.discoveryFlow.readingAriaLabel}
                />
                <Row
                  label={t.discoveryFlow.row.vin}
                  value={vin}
                  pending={false}
                  readingAriaLabel={t.discoveryFlow.readingAriaLabel}
                />
                <Row
                  label={t.discoveryFlow.row.protocol}
                  value={ecu?.protocol ?? null}
                  pending={step === "discovering" && !ecu}
                  readingAriaLabel={t.discoveryFlow.readingAriaLabel}
                />
                <Row
                  label={t.discoveryFlow.row.elmVersion}
                  value={ecu?.elm_version ?? null}
                  pending={step === "discovering" && !ecu}
                  readingAriaLabel={t.discoveryFlow.readingAriaLabel}
                />
                <Row
                  label={t.discoveryFlow.row.faultCodes}
                  value={
                    scan
                      ? dtcCount === 0
                        ? t.discoveryFlow.row.faultCodesClean
                        : t.discoveryFlow.row.faultCodesFound(dtcCount!)
                      : null
                  }
                  pending={step !== "results" && scan == null}
                  readingAriaLabel={t.discoveryFlow.readingAriaLabel}
                />
              </CardContent>
            </motion.div>
          </Card>
        </motion.div>

        <AnimatePresence>
          {(step === "results" || error) && (
            <motion.div
              layout="position"
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={appearVariants}
              className="self-center"
            >
              <Button onClick={onDone}>
                {t.discoveryFlow.goToDashboard} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
