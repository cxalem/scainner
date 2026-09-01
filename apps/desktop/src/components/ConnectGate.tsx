// A2 — the connect gate. One card, four states, in the order the user
// actually walks them (Brief F, 2026-09-01):
//
//   choose_device → connecting → connected
//                 ↘ failed ↗ (Try again) or ↩ (Choose another device)
//
// The device choice used to be a modal behind a "Choose adapter" button;
// it is the opening screen now, so the common case is one tap on Connect
// with the last-used device already selected. The screens share the card,
// the scene box's footprint and the button row, so moving between them
// never moves the layout under the pointer.
//
// Shown until the first successful connect of this app session; later
// disconnects stay inside the shell instead of kicking you back here.
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Plug, PlugZap, RefreshCw, ScanLine, Usb } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import { BRAND } from "@/brand";
import { Button, Pill } from "@/components/ui";
import { brandFromVin } from "@/lib/brand";
import { gateScreen } from "@/lib/device-list";
import { appearVariants, fadeVariants, screenVariants, staggerItem } from "@/motion";
import type { ConnStatus, ConnectStage } from "@scainner/core";
import { useT } from "@/i18n";
import { DeviceList, saveDeviceProfile, useDeviceList } from "@/components/DeviceList";

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
  /** Called when the user clicks through to the dashboard once connected.
   *  A KNOWN vehicle (not new — DiscoveryFlow owns that reveal instead)
   *  waits here rather than auto-advancing: a timed reveal was tried and
   *  reverted live (2026-08-30) — no fixed duration is right for every
   *  reader, so this stays a deliberate click, same pattern as
   *  DiscoveryFlow's own "Go to dashboard" button. Omit to auto-advance
   *  (used for the brand-new-vehicle path, where this gate hands off
   *  immediately and DiscoveryFlow's own button takes over). */
  onContinue?: () => void;
  /** The database already holds cars: offer to browse them without a cable. */
  canBrowse?: boolean;
  onBrowseOffline?: () => void;
}) {
  const t = useT();
  const stageLabel = (stage: ConnectStage) => t.gate.stages[stage];
  // One failed attempt, one stage, one reason — nothing retried behind the
  // scenes, so this is the whole story and the buttons below say so.
  const failure = conn.state === "disconnected" ? conn.error : null;
  const brand = brandFromVin(conn.vin);

  const devices = useDeviceList();
  const { refresh: refreshDevices, select: selectDevice } = devices;
  // The gap between the Connect click and the backend's first "connecting"
  // status, and the user stepping back from a failure to the list.
  const [starting, setStarting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The device this attempt is actually on, held while it runs: the list
  // may refresh under it (a Bluetooth node comes and goes).
  const [attempting, setAttempting] = useState<string | null>(null);

  const screen = gateScreen({
    state: conn.state,
    failed: failure != null,
    starting,
    choosing,
  });
  const connecting = screen === "connecting";
  const connected = screen === "connected";
  const brandKnown = brand != null && (connecting || connected);

  // The backend has taken over (or the attempt is over): drop the local
  // flags so the derivation above runs on the real status again.
  useEffect(() => {
    if (conn.state !== "disconnected") {
      setStarting(false);
      setChoosing(false);
    }
  }, [conn.state]);
  useEffect(() => {
    if (failure) setStarting(false);
  }, [failure]);
  // If the invoke itself never lands (the backend never reaches
  // "connecting"), fall back to the list rather than stranding the user on
  // a stage view nothing will ever advance — there is no cancel to offer.
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
      setStarting(true);
      setChoosing(false);
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

  // Warm the emblem's GLB the moment the VIN resolves a brand — before the
  // scene actually swaps to show it (brandKnown gates that below), so the
  // real emblem is usually already parsed by the time it needs to render
  // instead of EmblemFallback's loading plaque (2026-08-30). useLoader's
  // cache is shared by URL, so this also warms Overview/Vehicle's later
  // renders of the same brand for the rest of the session.
  useEffect(() => {
    if (!brand) return;
    void import("@/components/VehicleScene").then((m) => m.preloadEmblem(brand.key));
  }, [brand]);

  // The connection log: one line per thing the backend told us, in order.
  // Rebuilt from ConnStatus transitions, so it only ever says what happened.
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

  // What Connect / Try again acts on: the device the last attempt used
  // while a failure is on screen, the highlighted row otherwise.
  const target =
    (screen === "failed" ? (attempting ?? devices.selected?.id) : devices.selected?.id) ?? null;
  const canConnect = devices.rows.some((row) => row.id === target && row.selectable);
  const attemptedName =
    devices.rows.find((row) => row.id === attempting)?.name ?? devices.selected?.name ?? null;
  const title = connecting || connected
    ? brandKnown
      ? t.gate.recognised(brand!.name)
      : t.gate.reading
    : screen === "failed"
      ? t.gate.plugIn
      : t.gate.chooseDeviceTitle;
  const body = connecting || connected
    ? brandKnown
      ? t.gate.recognisedBody(brand!.name)
      : t.gate.readingBody
    : t.gate.plugInBody(BRAND.name);
  // The name of the device this attempt is on, under the heading.
  const subject = connecting || screen === "failed" ? attemptedName : null;

  return (
    <motion.div
      // fixed inset-0, not h-screen: see Login.tsx's own comment on the
      // same fix — an h-screen sibling stacks in document flow instead of
      // overlaying Shell during the exit fade, which showed up as a blank
      // flash right at the connect→dashboard handoff (2026-08-30).
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
        {/* the box holds its size in every state — the device list, the
            plug and the emblem all live in the same footprint, so nothing
            jumps between the screens */}
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
              {connecting ? t.gate.connecting : screen === "failed" ? t.gate.tryAgain : t.gate.connect}
            </Button>
          )}
          <span className="inline-flex items-center gap-[7px] text-[12px] text-neutral-500">
            <Usb className="h-[15px] w-[15px]" aria-hidden="true" />
            {conn.elm_version ?? t.shell.adapterFallback}
          </span>
        </div>

        {screen === "choose_device" && (
          <Button variant="ghost" size="sm" icon={RefreshCw} busy={devices.loading} onClick={() => void refreshDevices()}>
            {t.gate.refreshAdapters}
          </Button>
        )}
        {screen === "failed" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setChoosing(true);
              void refreshDevices();
            }}
          >
            {t.gate.chooseAnotherDevice}
          </Button>
        )}

        <AnimatePresence initial={false}>
          {(saveError || devices.error || failure || (conn.detail && conn.state === "disconnected")) && (
            <motion.p
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={appearVariants}
              className="max-w-[46ch] text-center text-[12px] leading-snug text-stop"
              role="alert"
            >
              {saveError ??
                devices.error ??
                (failure ? t.gate.failedAt(stageLabel(failure.stage), failure.reason) : conn.detail)}
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
