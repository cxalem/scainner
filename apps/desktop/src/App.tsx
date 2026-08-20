import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@/lib/tauri";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { Shell, type ViewKey } from "@/components/Shell";
import { ConnectGate } from "@/components/ConnectGate";
import { Overview } from "@/views/Overview";
import { Live } from "@/views/Live";
import { History } from "@/views/History";
import { Diagnose } from "@/views/Diagnose";
import { Lab } from "@/views/Lab";
import type { ConnStatus, Live as LiveMap } from "@scainner/core";

// Code-split: pulls in three.js/@react-three (~450KB gzip) only once
// something that needs the 3D scene — Overview (once connected),
// DiscoveryFlow, or the Vehicle tab's own identity/data cards — actually
// mounts, not on initial app load. Vehicle itself no longer renders the 3D
// scene (that moved to Overview), it's still code-split for the shared
// three.js chunk boundary.
const Vehicle = lazy(() => import("@/views/Vehicle").then((m) => ({ default: m.Vehicle })));
const DiscoveryFlow = lazy(() =>
  import("@/components/DiscoveryFlow").then((m) => ({ default: m.DiscoveryFlow })),
);

export default function App() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewKey>("overview");
  const [conn, setConn] = useState<ConnStatus>({ state: "disconnected" });
  const [live, setLive] = useState<LiveMap>({});
  const staleTimer = useRef<number | null>(null);

  // Snapshot of VINs already known when the app started — NOT re-fetched
  // after connecting, so it stays a stable "have we seen this car before"
  // comparison for the session. A VIN missing from this set on connect
  // triggers the one-time discovery flow instead of dropping straight into
  // the dashboard.
  const [knownVins, setKnownVins] = useState<Set<string> | null>(null);
  const [discoverVin, setDiscoverVin] = useState<string | null>(null);
  // The currently-connected car's VIN, known as early as car_info resolves
  // (same handler as discoverVin below) — passed down to Overview so its
  // emblem shows the right brand from Overview's very first render instead
  // of a brief generic badge while Overview's own, slower report_cars fetch
  // catches up. Kept separate from discoverVin, which only ever holds a
  // *new* car's VIN and is cleared once the discovery overlay finishes.
  const [currentVin, setCurrentVin] = useState<string | null>(null);
  // Sticky on purpose — once true it stays true for the rest of the app
  // session, even across later disconnects. Gates the blank ConnectGate
  // screen, not the Shell's own per-view "disconnected" states.
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  useEffect(() => {
    // Warm the DiscoveryFlow chunk (it drags in three.js) while the user is
    // still looking at the connect gate, so first connect doesn't pay the
    // chunk load inside the gate→overlay transition.
    void import("@/components/DiscoveryFlow");
    runPromise(Effect.flatMap(DeviceService, (device) => device.connStatus()))
      .then(setConn)
      .catch(() => {});
    runPromise(Effect.flatMap(DeviceService, (device) => device.reportCars()))
      .then((cars) => setKnownVins(new Set(cars.map(([v]) => v))))
      .catch(() => setKnownVins(new Set()));
    const un1 = listen<ConnStatus>("conn-status", (e) => {
      setConn(e.payload);
      // A new session can add data behind any view, and a blanket
      // revalidate is cheap over local IPC — a curated per-command
      // invalidation list would only rot as commands are added
      // (decisions-plan.md: "Invalidate everything on connect, nothing on
      // live-update"). live-update is deliberately excluded: it fires
      // continuously and would thrash the cache.
      if (e.payload.state === "connected") void queryClient.invalidateQueries();
    });
    const un2 = listen<LiveMap>("live-update", (e) => {
      setLive((prev) => ({ ...prev, ...e.payload }));
      if (staleTimer.current) window.clearTimeout(staleTimer.current);
      staleTimer.current = window.setTimeout(() => setLive({}), 10000);
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [queryClient]);

  // Fires once per newly-seen VIN: the backend already stamps the VIN onto
  // the session during its connect handshake, so by the time conn.state
  // flips to "connected" it's readable straight back via car_info.
  //
  // hasConnectedOnce is deliberately set HERE, inside the same then-handler
  // that decides whether the discovery overlay mounts — not in a separate
  // conn.state effect. Setting it earlier revealed the dashboard for the
  // few frames between "connected" and the car_info round-trip resolving,
  // a visible flash before the overlay covered it. Batching both setStates
  // in one handler makes Shell and DiscoveryFlow mount in the same render,
  // so the overlay is there from the dashboard's very first frame.
  useEffect(() => {
    if (conn.state !== "connected" || knownVins === null) return;
    runPromise(Effect.flatMap(DeviceService, (device) => device.carInfo()))
      .then((rows) => {
        const vin = Object.fromEntries(rows).vin as string | undefined;
        if (vin) setCurrentVin(vin);
        if (vin && !knownVins.has(vin)) {
          setKnownVins((prev) => new Set(prev ?? []).add(vin));
          setDiscoverVin(vin);
        }
        setHasConnectedOnce(true);
      })
      .catch(() => setHasConnectedOnce(true)); // never strand the user on the gate
    // Re-runs when knownVins settles (it loads async on mount, and a
    // connect can beat it) and again when this effect adds the new VIN to
    // it — that second run is a harmless no-op: the VIN is known by then,
    // and setHasConnectedOnce(true) is idempotent.
  }, [conn.state, knownVins]);

  const connected = conn.state === "connected";
  const recording = connected && Object.keys(live).length > 0;

  if (!hasConnectedOnce) {
    return <ConnectGate conn={conn} onConnect={() => runPromise(Effect.flatMap(DeviceService, (device) => device.connect()))} />;
  }

  return (
    <>
      <Shell
        view={view}
        onNavigate={setView}
        conn={conn}
        recording={recording}
        onConnect={() => runPromise(Effect.flatMap(DeviceService, (device) => device.connect()))}
        onDisconnect={() => runPromise(Effect.flatMap(DeviceService, (device) => device.disconnect()))}
      >
        {view === "overview" && <Overview connState={conn.state} vin={currentVin} />}
        {view === "live" && <Live live={live} connected={connected} />}
        {view === "history" && <History />}
        {view === "diagnose" && <Diagnose connected={connected} />}
        {view === "lab" && <Lab connected={connected} />}
        {view === "vehicle" && (
          <Suspense fallback={<div className="h-64 w-full animate-pulse rounded-lg bg-muted sm:h-72" />}>
            <Vehicle connected={connected} />
          </Suspense>
        )}
      </Shell>
      {discoverVin && (
        // Fallback is a full-screen cover, NOT null — with a null fallback,
        // the frames while the lazy chunk loads showed the dashboard
        // uncovered (the "layout shift" flash on first connect).
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-background" />}>
          <DiscoveryFlow
            vin={discoverVin}
            onDone={() => {
              setDiscoverVin(null);
              // Replaces the old refreshKey counter (plan.md rule 3):
              // Overview mounted before this car existed, so its own
              // queries wouldn't otherwise know to refetch.
              queryClient.invalidateQueries({ queryKey: ["report_cars"] });
              queryClient.invalidateQueries({ queryKey: ["car_report"] });
            }}
          />
        </Suspense>
      )}
    </>
  );
}
