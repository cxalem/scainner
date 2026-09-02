// A2 — the connect gate. One card, three states, in the order the user
// actually walks them (Brief F, 2026-09-01):
//
//   choose_device → connecting → connected
//        ↖________________↙ (a failed attempt, reported in a toast)
//
// The device choice used to be a modal behind a "Choose adapter" button;
// it is the opening screen now, so the common case is one tap on Connect
// with the last-used device already selected. The screens share the card,
// the scene box's footprint and the button row, so moving between them
// never moves the layout under the pointer.
//
// A failed attempt has no screen of its own (Brief M, 2026-09-02). It drops
// straight back to the device list with the device it tried still selected
// — so Connect alone retries it — and says what went wrong in a toast over
// the top: end-user words, one recovery action each, and the transport
// error itself behind Details for a support screenshot. The inline red line
// it replaces both said the wrong thing and moved the whole card while the
// user's hand was already on the way to the button.
//
// Shown until the first successful connect of this app session; later
// disconnects stay inside the shell instead of kicking you back here.
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Plug, PlugZap, RefreshCw, ScanLine, Usb } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import { BRAND } from "@/brand";
import { Button, Pill, Toast } from "@/components/ui";
import { brandFromVin } from "@/lib/brand";
import { gateScreen, stageMessage } from "@/lib/device-list";
import { appearVariants, fadeVariants, screenVariants, staggerItem } from "@/motion";
import type { ConnStatus, ConnectFailure, ConnectStage } from "@scainner/core";
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
  // scenes, so this is the whole story and the toast says so.
  const failure = conn.state === "disconnected" ? conn.error : null;
  const brand = brandFromVin(conn.vin);

  const devices = useDeviceList();
  const { refresh: refreshDevices, select: selectDevice } = devices;
  // The gap between the Connect click and the backend's first "connecting"
  // status.
  const [starting, setStarting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The device this attempt is actually on, held while it runs: the list
  // may refresh under it (a Bluetooth node comes and goes).
  const [attempting, setAttempting] = useState<string | null>(null);
  // The failure the toast is showing, and whether it is up. Held separately
  // from `conn.error` so dismissing it sticks: the status object is rebuilt
  // on every event the backend sends, and reading it directly would reopen
  // the toast the user just closed. The failure outlives the dismissal by
  // one animation — blanking the words mid fade-out would be visible.
  const [shownFailure, setShownFailure] = useState<ConnectFailure | null>(null);
  const [failureOpen, setFailureOpen] = useState(false);
  const failureKey = failure ? `${failure.stage} ${failure.reason}` : null;

  const screen = gateScreen({ state: conn.state, starting });
  const connecting = screen === "connecting";
  const connected = screen === "connected";
  const brandKnown = brand != null && (connecting || connected);

  // The backend has taken over (or the attempt is over): drop the local
  // flag so the derivation above runs on the real status again.
  useEffect(() => {
    if (conn.state !== "disconnected") setStarting(false);
  }, [conn.state]);
  useEffect(() => {
    if (failure) setStarting(false);
  }, [failure]);
  // A new failure raises the toast; the next attempt clearing the error
  // takes it away again.
  useEffect(() => {
    if (failureKey && failure) setShownFailure(failure);
    setFailureOpen(failureKey != null);
    // `failure` changes identity on every status event — the key is what
    // actually says "this is a different failure".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failureKey]);
  // The attempt is over, so the list is live again: put the highlight back
  // on the device it was on, which is what Connect and Try again both act
  // on.
  useEffect(() => {
    if (failureKey && attempting) selectDevice(attempting);
  }, [failureKey, attempting, selectDevice]);
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
      setFailureOpen(false);
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

  // What Connect and the toast's Try again both act on: the highlighted
  // row, which a failure has just put back on the device that failed.
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
  // The name of the device this attempt is on, under the heading.
  const subject = connecting ? attemptedName : null;

  // What the toast says: the stage picks the sentence, the reason decides
  // whether there is a second line worth acting on.
  const failureCopy = shownFailure ? stageMessage(shownFailure.stage, shownFailure.reason) : null;
  const dismissFailure = useCallback(() => setFailureOpen(false), []);
  const chooseAnotherDevice = useCallback(() => {
    setFailureOpen(false);
    void refreshDevices();
  }, [refreshDevices]);

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

        {/* Re-enumerating is a footnote to the list, not a step in the
            flow: the scan the user actually reaches for lives in the card's
            own header now (Brief K), where its results are visible without
            scrolling. */}
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
        {/* Only the two things the list itself can get wrong stay inline.
            A failed connection goes to the toast below instead — it is the
            one message that used to move this column while the user was
            already reaching for Connect. */}
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

      <Toast
        open={failureOpen && failureCopy != null}
        onClose={dismissFailure}
        icon={AlertTriangle}
        title={failureCopy ? t.gate.failure[failureCopy.message] : ""}
        dismissLabel={t.common.close}
        detailsLabel={t.gate.failureDetails}
        // The technical text a support screenshot needs, one click away and
        // never the first thing read. It is in the log file either way.
        details={shownFailure ? `${stageLabel(shownFailure.stage)}: ${shownFailure.reason}` : null}
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              icon={PlugZap}
              disabled={!canConnect}
              onClick={() => void connectTo(target)}
            >
              {t.gate.tryAgain}
            </Button>
            <Button variant="ghost" size="sm" onClick={chooseAnotherDevice}>
              {t.gate.chooseAnotherDevice}
            </Button>
          </>
        }
      >
        {failureCopy?.hint && (
          <p className="text-[12px] leading-snug text-neutral-500">
            {t.gate.failureHints[failureCopy.hint]}
          </p>
        )}
      </Toast>
    </motion.div>
  );
}
