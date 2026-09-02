import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Plug, PlugZap, RefreshCw, ScanLine, Usb } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import { BRAND } from "@/brand";
import { Button, Pill } from "@/components/ui";
import { useToast } from "@/components/toast";
import { brandFromVin } from "@/lib/brand";
import { gateScreen, stageMessage } from "@/lib/device-list";
import { appearVariants, fadeVariants, screenVariants, staggerItem } from "@/motion";
import type { ConnStatus, ConnectStage } from "@scainner/core";
import { useT } from "@/i18n";
import { DeviceList, saveDeviceProfile, useDeviceList } from "@/components/DeviceList";

const CONNECT_FAILURE_TOAST = "connect-failure";

const VehicleScene = lazy(() => import("@/components/VehicleScene").then((m) => ({ default: m.VehicleScene })));

export function ConnectGate({
  conn,
  onConnect,
  onContinue,
  canBrowse = false,
  onBrowseOffline,
}: {
  conn: ConnStatus;
  onConnect: () => void;
  onContinue?: () => void;
  canBrowse?: boolean;
  onBrowseOffline?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const stageLabel = (stage: ConnectStage) => t.gate.stages[stage];
  const failure = conn.state === "disconnected" ? conn.error : null;
  const brand = brandFromVin(conn.vin);

  const devices = useDeviceList();
  const { refresh: refreshDevices, select: selectDevice } = devices;
  const [starting, setStarting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempting, setAttempting] = useState<string | null>(null);
  const failureKey = failure ? `${failure.stage} ${failure.reason}` : null;

  const screen = gateScreen({ state: conn.state, starting });
  const connecting = screen === "connecting";
  const connected = screen === "connected";
  const brandKnown = brand != null && (connecting || connected);

  useEffect(() => {
    if (conn.state !== "disconnected") setStarting(false);
  }, [conn.state]);
  useEffect(() => {
    if (failure) setStarting(false);
  }, [failure]);
  useEffect(() => {
    if (failureKey && attempting) selectDevice(attempting);
  }, [failureKey, attempting, selectDevice]);
  useEffect(() => {
    if (!starting) return;
    const id = setTimeout(() => setStarting(false), 8000);
    return () => clearTimeout(id);
  }, [starting]);

  const connectTo = useCallback(
    async (deviceId: string | null) => {
      const row = devices.rows.find((r) => r.id === deviceId);
      if (!row?.selectable) return;
      setSaveError(null);
      toast.dismiss(CONNECT_FAILURE_TOAST);
      setStarting(true);
      setAttempting(row.id);
      try {
        await saveDeviceProfile(row);
      } catch {
        setStarting(false);
        setSaveError(t.gate.adapterSaveFailed);
        return;
      }
      onConnect();
    },
    [devices.rows, onConnect, t.gate.adapterSaveFailed],
  );

  useEffect(() => {
    if (!brand) return;
    void import("@/components/VehicleScene").then((m) => m.preloadEmblem(brand.key));
  }, [brand]);

  const [lines, setLines] = useState<string[]>([]);
  const seen = useRef({ adapter: false, vin: false });
  useEffect(() => {
    if (conn.state === "disconnected") {
      setLines([]);
      seen.current = { adapter: false, vin: false };
      return;
    }
    if (conn.state === "connecting" && lines.length === 0) setLines([t.gate.lines.lookingForAdapter]);
    if (conn.elm_version && !seen.current.adapter) {
      seen.current.adapter = true;
      setLines((l) => [...l, t.gate.lines.adapterFound(conn.elm_version!), t.gate.lines.wakingBus]);
    }
    if (conn.vin && !seen.current.vin) {
      seen.current.vin = true;
      const b = brandFromVin(conn.vin);
      setLines((l) => [
        ...l,
        t.gate.lines.vinRead(conn.vin!),
        ...(b ? [t.gate.lines.recognisedFrom(b.name, conn.vin!.slice(0, 3).toUpperCase())] : []),
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.state, conn.elm_version, conn.vin]);

  const target = devices.selected?.id ?? attempting ?? null;
  const canConnect = devices.rows.some((row) => row.id === target && row.selectable);
  const attemptedName =
    devices.rows.find((row) => row.id === attempting)?.name ?? devices.selected?.name ?? null;
  const title = connecting || connected
    ? brandKnown
      ? t.gate.recognised(brand!.name)
      : t.gate.reading
    : t.gate.chooseDeviceTitle;
  const body = connecting || connected
    ? brandKnown
      ? t.gate.recognisedBody(brand!.name)
      : t.gate.readingBody
    : t.gate.plugInBody(BRAND.name);
  const subject = connecting ? attemptedName : null;

  const chooseAnotherDevice = useCallback(() => {
    toast.dismiss(CONNECT_FAILURE_TOAST);
    void refreshDevices();
  }, [refreshDevices]);

  const live = useRef({ connectTo, chooseAnotherDevice, target });
  live.current = { connectTo, chooseAnotherDevice, target };

  useEffect(() => {
    if (!failureKey || !failure) {
      toast.dismiss(CONNECT_FAILURE_TOAST);
      return;
    }
    const copy = stageMessage(failure.stage, failure.reason);
    toast.show("error", t.gate.failure[copy.message], {
      id: CONNECT_FAILURE_TOAST,
      description: copy.hint ? t.gate.failureHints[copy.hint] : undefined,
      action: {
        label: t.gate.tryAgain,
        disabled: !canConnect,
        onClick: () => void live.current.connectTo(live.current.target),
      },
      secondaryAction: {
        label: t.gate.chooseAnotherDevice,
        onClick: () => live.current.chooseAnotherDevice(),
      },
      details: `${stageLabel(failure.stage)}: ${failure.reason}`,
      detailsLabel: t.gate.failureDetails,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failureKey]);

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center bg-bg text-text"
      style={{ background: "radial-gradient(60% 50% at 50% 0%, var(--accent-900), var(--bg) 70%)" }}
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={screenVariants}
    >
      {MOCK_MODE && (
        <Pill variant="warn" className="absolute right-4 top-4" title={t.shell.demoDataTooltip}>
          {t.shell.demoData}
        </Pill>
      )}
      <div className="flex w-full max-w-[620px] flex-col items-center gap-5 p-8">
        <div className="relative flex h-[230px] w-full items-center justify-center overflow-hidden rounded-md border border-divider bg-surface shadow-md">
          <AnimatePresence mode="wait" initial={false}>
            {brandKnown ? (
              <motion.div key="scene" className="absolute inset-0" initial="hidden" animate="visible" exit="exit" variants={fadeVariants}>
                <Suspense fallback={null}>
                  <VehicleScene status={connected ? "connected" : "connecting"} vin={conn.vin} className="h-full rounded-none" />
                </Suspense>
              </motion.div>
            ) : screen === "choose_device" ? (
              <motion.div key="devices" className="absolute inset-0" initial="hidden" animate="visible" exit="exit" variants={fadeVariants}>
                <DeviceList
                  rows={devices.rows}
                  selectedId={devices.selected?.id ?? null}
                  onSelect={selectDevice}
                  loading={devices.loading}
                  discovery={devices.discovery}
                />
              </motion.div>
            ) : (
              <motion.div
                key="plug"
                className="flex flex-col items-center gap-[15px] text-neutral-500"
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={fadeVariants}
              >
                <div className="relative flex h-24 w-24 items-center justify-center">
                  <span className={cn("absolute inset-0 rounded-full border border-divider", connecting && "animate-glow")} aria-hidden="true" />
                  <span
                    className={cn("absolute inset-3.5 rounded-full border border-divider", connecting && "animate-glow [animation-delay:.4s]")}
                    aria-hidden="true"
                  />
                  {connecting ? (
                    <ScanLine className="relative h-8 w-8 animate-pulse text-accent-400" aria-hidden="true" />
                  ) : (
                    <Plug className="relative h-8 w-8 text-neutral-600" aria-hidden="true" />
                  )}
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[12.5px] text-neutral-400">
                    {connecting ? (conn.stage ? stageLabel(conn.stage) : t.gate.readingVin) : t.gate.noAdapter}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.1em] text-neutral-600">
                    {connecting ? t.gate.brandUnknownYet : t.gate.plugToBegin}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex max-w-[44ch] flex-col items-center gap-[7px] text-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={title} initial="hidden" animate="visible" exit="exit" variants={appearVariants} className="flex flex-col gap-[7px]">
              <h1 className="text-[26px]">{title}</h1>
              {subject && <p className="num text-[12.5px] text-neutral-400">{subject}</p>}
              <p className="text-[13.5px] leading-[1.6] text-neutral-500">{body}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="num flex min-h-[18px] flex-col items-center gap-1 text-[12.5px] text-neutral-500" aria-live="polite">
          <AnimatePresence initial={false}>
            {lines.map((l) => (
              <motion.span key={l} initial="hidden" animate="visible" exit="exit" variants={staggerItem}>
                {l}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2.5">
          {connected && onContinue ? (
            <Button variant="primary" size="lg" onClick={onContinue}>
              {t.discoveryFlow.goToDashboard} <ArrowRight aria-hidden="true" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              icon={PlugZap}
              busy={connecting}
              onClick={() => void connectTo(target)}
              disabled={connected || (!connecting && !canConnect)}
            >
              {connecting ? t.gate.connecting : t.gate.connect}
            </Button>
          )}
          <span className="inline-flex items-center gap-[7px] text-[12px] text-neutral-500">
            <Usb className="h-[15px] w-[15px]" aria-hidden="true" />
            {conn.elm_version ?? t.shell.adapterFallback}
          </span>
        </div>

        {screen === "choose_device" && (
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            className="text-[11.5px]"
            busy={devices.loading}
            onClick={() => void refreshDevices()}
          >
            {t.gate.refreshAdapters}
          </Button>
        )}
        <AnimatePresence initial={false}>
          {(saveError || devices.error) && (
            <motion.p
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={appearVariants}
              className="max-w-[46ch] text-center text-[12px] leading-snug text-stop"
              role="alert"
            >
              {saveError ?? devices.error}
            </motion.p>
          )}
        </AnimatePresence>

        {canBrowse && onBrowseOffline && conn.state === "disconnected" && (
          <Button variant="ghost" size="sm" onClick={onBrowseOffline}>
            {t.gate.browseOffline}
          </Button>
        )}
      </div>

    </motion.div>
  );
}
