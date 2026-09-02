import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Banner, Button, Card, Mono, Pill, Spinner } from "@/components/ui";
import { VehicleScene } from "@/components/VehicleScene";
import type { DtcResult, EcuInfo } from "@scainner/core";
import { brandFromVin } from "@/lib/brand";
import { decodeModelYear } from "@/lib/vin";
import { appearVariants, backdropVariants, fadeTransition, layoutTransition, staggerContainer, staggerItem } from "@/motion";
import { useT } from "@/i18n";

type Step = "discovering" | "scanning" | "results";

function Row({ label, value, pending, readingAriaLabel }: { label: string; value: string | null; pending: boolean; readingAriaLabel: string }) {
  return (
    <motion.div variants={staggerItem} className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-neutral-500">{label}</span>
      <AnimatePresence mode="wait" initial={false}>
        {pending ? (
          <motion.span key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fadeTransition}>
            <Spinner className="h-3.5 w-3.5 text-neutral-500" aria-label={readingAriaLabel} />
          </motion.span>
        ) : (
          <motion.span key="value" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={fadeTransition}>
            <Mono className="text-[12.5px]">{value ?? "—"}</Mono>
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
        yield* Effect.sleep("700 millis");
        setStep("scanning");
        const dtc = yield* device.scanDtcs().pipe(Effect.catchAll(() => Effect.succeed(null)));
        setScan(dtc);
        setStep("results");
      }),
    ).catch((e) => setError(String(e)));
  }, []);

  const sceneStatus = step === "results" ? "connected" : "connecting";
  const dtcCount = scan ? scan.stored.length + scan.pending.length : null;
  const brand = brandFromVin(vin);
  const modelYear = decodeModelYear(vin);

  useEffect(() => {
    if (!brand) return;
    void import("@/components/VehicleScene").then((m) => m.preloadEmblem(brand.key));
  }, [brand]);
  const title = step === "discovering" ? t.discoveryFlow.step.discoveringTitle : step === "scanning" ? t.discoveryFlow.step.scanningTitle : t.discoveryFlow.step.resultsTitle;
  const subtitle = step === "discovering" ? t.discoveryFlow.step.discoveringSubtitle : step === "scanning" ? t.discoveryFlow.step.scanningSubtitle : t.discoveryFlow.step.resultsSubtitle;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex overflow-y-auto p-6 text-text"
      style={{ background: "radial-gradient(60% 50% at 50% 0%, var(--accent-900), var(--bg) 70%)" }}
      initial={false}
      animate="visible"
      exit="exit"
      variants={backdropVariants}
    >
      <div className="m-auto flex w-full max-w-[520px] flex-col gap-5 py-8">
        <div className="overflow-hidden rounded-md border border-divider bg-surface shadow-md">
          <VehicleScene status={sceneStatus} vin={vin} className="h-[230px] rounded-none" />
        </div>

        <div className="flex flex-col items-center gap-[7px] text-center">
          <Pill variant="accent">{t.discoveryFlow.newVehicle}</Pill>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial="hidden" animate="visible" exit="exit" variants={appearVariants} className="flex flex-col gap-[7px]">
              <h1 className="text-[26px]" aria-live="polite">{title}</h1>
              <p className="text-[13.5px] leading-[1.6] text-neutral-500">{subtitle}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        <AnimatePresence initial={false}>
          {error && (
            <motion.div layout="position" transition={layoutTransition} initial="hidden" animate="visible" exit="exit" variants={appearVariants}>
              <Banner tone="stop" icon={AlertTriangle} className="rounded-md">
                {error}
              </Banner>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div layout="position" transition={layoutTransition}>
          <Card>
            <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="flex flex-col gap-2.5">
              <Row
                label={t.discoveryFlow.row.vehicle}
                value={brand ? `${brand.name}${modelYear ? `, ${modelYear}` : ""}` : t.discoveryFlow.row.unrecognizedBrand}
                pending={false}
                readingAriaLabel={t.discoveryFlow.readingAriaLabel}
              />
              <Row label={t.discoveryFlow.row.vin} value={vin} pending={false} readingAriaLabel={t.discoveryFlow.readingAriaLabel} />
              <Row label={t.discoveryFlow.row.protocol} value={ecu?.protocol ?? null} pending={step === "discovering" && !ecu} readingAriaLabel={t.discoveryFlow.readingAriaLabel} />
              <Row label={t.discoveryFlow.row.elmVersion} value={ecu?.elm_version ?? null} pending={step === "discovering" && !ecu} readingAriaLabel={t.discoveryFlow.readingAriaLabel} />
              <Row
                label={t.discoveryFlow.row.faultCodes}
                value={scan ? (dtcCount === 0 ? t.discoveryFlow.row.faultCodesClean : t.discoveryFlow.row.faultCodesFound(dtcCount!)) : null}
                pending={step !== "results" && scan == null}
                readingAriaLabel={t.discoveryFlow.readingAriaLabel}
              />
            </motion.div>
          </Card>
        </motion.div>

        <AnimatePresence>
          {(step === "results" || error) && (
            <motion.div layout="position" transition={layoutTransition} initial="hidden" animate="visible" exit="exit" variants={appearVariants} className="self-center">
              <Button variant="primary" size="lg" onClick={onDone}>
                {t.discoveryFlow.goToDashboard} <ArrowRight aria-hidden="true" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
