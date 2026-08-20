import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { invoke, listen } from "@/lib/tauri";
import { Shell, type ViewKey } from "@/components/Shell";
import { ConnectGate } from "@/components/ConnectGate";
import { Overview } from "@/views/Overview";
import { Live } from "@/views/Live";
import { History } from "@/views/History";
import { Diagnose } from "@/views/Diagnose";
import { Lab } from "@/views/Lab";
import type { ConnStatus, Live as LiveMap } from "@/lib/meta";

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
  const [refreshKey, setRefreshKey] = useState(0);
  // Sticky on purpose — once true it stays true for the rest of the app
  // session, even across later disconnects. Gates the blank ConnectGate
  // screen, not the Shell's own per-view "disconnected" states.
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  useEffect(() => {
    // Warm the DiscoveryFlow chunk (it drags in three.js) while the user is
    // still looking at the connect gate, so first connect doesn't pay the
    // chunk load inside the gate→overlay transition.
    void import("@/components/DiscoveryFlow");
    invoke<ConnStatus>("conn_status").then(setConn).catch(() => {});
    invoke<[string, number][]>("report_cars")
      .then((cars) => setKnownVins(new Set(cars.map(([v]) => v))))
      .catch(() => setKnownVins(new Set()));
    const un1 = listen<ConnStatus>("conn-status", (e) => setConn(e.payload));
    const un2 = listen<LiveMap>("live-update", (e) => {
      setLive((prev) => ({ ...prev, ...e.payload }));
      if (staleTimer.current) window.clearTimeout(staleTimer.current);
      staleTimer.current = window.setTimeout(() => setLive({}), 10000);
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, []);

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
    invoke<[string, string][]>("car_info")
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
    return <ConnectGate conn={conn} onConnect={() => invoke("connect")} />;
  }

  return (
    <>
      <Shell
        view={view}
        onNavigate={setView}
        conn={conn}
        recording={recording}
        onConnect={() => invoke("connect")}
        onDisconnect={() => invoke("disconnect")}
      >
        {view === "overview" && <Overview refreshKey={refreshKey} connState={conn.state} vin={currentVin} />}
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
              setRefreshKey((k) => k + 1);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
