import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@/lib/tauri";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { Shell, type ViewKey } from "@/components/Shell";
import { ConnectGate } from "@/components/ConnectGate";
import { OnboardingGate } from "@/components/OnboardingGate";
import { hasOnboarded, markOnboarded } from "@/lib/onboarding";
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

  // Schema v2: the backend resolves the connected vehicle's identity itself
  // and reports it on ConnStatus (vehicle_id/vin/display_name/
  // vehicle_is_new). The old knownVins snapshot + car_info round trip are
  // gone — vehicle_is_new IS the "have we seen this car before" answer,
  // straight from the vehicles table, computed in the same transaction that
  // created (or found) the row. See docs/workflows/data-core/plan.md.
  const [discoverVin, setDiscoverVin] = useState<string | null>(null);
  // Sticky on purpose — once true it stays true for the rest of the app
  // session, even across later disconnects. Gates the blank ConnectGate
  // screen, not the Shell's own per-view "disconnected" states.
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);
  // Persisted (lib/onboarding.ts), unlike hasConnectedOnce above — the
  // language-confirm screen should show once ever on this install, not
  // once per app session.
  const [onboarded, setOnboarded] = useState(() => hasOnboarded());

  useEffect(() => {
    // Warm the DiscoveryFlow chunk (it drags in three.js) while the user is
    // still looking at the connect gate, so first connect doesn't pay the
    // chunk load inside the gate→overlay transition.
    void import("@/components/DiscoveryFlow");
    runPromise(Effect.flatMap(DeviceService, (device) => device.connStatus()))
      .then(setConn)
      .catch(() => {});
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

  // hasConnectedOnce is deliberately set in the SAME effect that decides
  // whether the discovery overlay mounts, not a separate conn.state effect
  // — batching both setStates in one render is what keeps Shell and
  // DiscoveryFlow mounting together, so the overlay covers the dashboard's
  // very first frame instead of flashing it uncovered first.
  useEffect(() => {
    if (conn.state !== "connected") return;
    if (conn.vehicle_is_new && conn.vin) setDiscoverVin(conn.vin);
    setHasConnectedOnce(true);
  }, [conn.state, conn.vehicle_is_new, conn.vin]);

  const currentVin = conn.vin ?? null;
  const currentVehicleId = conn.vehicle_id ?? null;

  const connected = conn.state === "connected";
  const recording = connected && Object.keys(live).length > 0;

  if (!onboarded) {
    return (
      <OnboardingGate
        onDone={() => {
          markOnboarded();
          setOnboarded(true);
        }}
      />
    );
  }

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
        {view === "overview" && <Overview connState={conn.state} vehicleId={currentVehicleId} vin={currentVin} />}
        {view === "live" && <Live live={live} connected={connected} />}
        {view === "history" && <History connState={conn.state} vehicleId={currentVehicleId} />}
        {view === "diagnose" && <Diagnose connected={connected} vehicleId={currentVehicleId} />}
        {view === "lab" && <Lab connected={connected} />}
        {view === "vehicle" && (
          <Suspense fallback={<div className="h-64 w-full animate-pulse rounded-lg bg-muted sm:h-72" />}>
            <Vehicle connected={connected} vehicleId={currentVehicleId} />
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
              queryClient.invalidateQueries({ queryKey: ["list_vehicles"] });
              queryClient.invalidateQueries({ queryKey: ["vehicle_report"] });
            }}
          />
        </Suspense>
      )}
    </>
  );
}
