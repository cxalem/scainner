// A2 — the connect gate. One card: the scene (an empty plug until the VIN
// resolves, then the brand's emblem), a title that changes as the car is
// read, a log of what happened, and one button. Shown until the first
// successful connect of this app session; later disconnects stay inside
// the shell instead of kicking you back here.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Plug, PlugZap, ScanLine, Usb } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import { BRAND } from "@/brand";
import { Button, Pill } from "@/components/ui";
import { brandFromVin } from "@/lib/brand";
import { appearVariants, fadeVariants, screenVariants, staggerItem } from "@/motion";
import type { ConnStatus } from "@scainner/core";
import { useT } from "@/i18n";

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
  const connecting = conn.state === "connecting";
  const connected = conn.state === "connected";
  const brand = brandFromVin(conn.vin);
  const brandKnown = brand != null && (connecting || connected);

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

  const title = connecting || connected
    ? brandKnown
      ? t.gate.recognised(brand!.name)
      : t.gate.reading
    : t.gate.plugIn;
  const body = connecting || connected
    ? brandKnown
      ? t.gate.recognisedBody(brand!.name)
      : t.gate.readingBody
    : t.gate.plugInBody(BRAND.name);

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
        {/* the scene box holds its size in every state — no jump when the emblem lands */}
        <div className="relative flex h-[230px] w-full items-center justify-center overflow-hidden rounded-md border border-divider bg-surface shadow-md">
          <AnimatePresence mode="wait" initial={false}>
            {brandKnown ? (
              <motion.div key="scene" className="absolute inset-0" initial="hidden" animate="visible" exit="exit" variants={fadeVariants}>
                <Suspense fallback={null}>
                  <VehicleScene status={connected ? "connected" : "connecting"} vin={conn.vin} className="h-full rounded-none" />
                </Suspense>
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
                  <span className="text-[12.5px] text-neutral-400">{connecting ? t.gate.readingVin : t.gate.noAdapter}</span>
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
            <Button variant="primary" size="lg" icon={PlugZap} busy={connecting} onClick={onConnect} disabled={connected}>
              {connecting ? t.gate.connecting : t.gate.connect}
            </Button>
          )}
          <span className="inline-flex items-center gap-[7px] text-[12px] text-neutral-500">
            <Usb className="h-[15px] w-[15px]" aria-hidden="true" />
            {conn.elm_version ?? t.shell.adapterFallback}
          </span>
        </div>

        <AnimatePresence initial={false}>
          {conn.detail && conn.state === "disconnected" && (
            <motion.p
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={appearVariants}
              className="max-w-[46ch] text-center text-[12px] leading-snug text-stop"
            >
              {conn.detail}
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
