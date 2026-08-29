import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { listen } from "@/lib/tauri";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { Shell, type ViewKey } from "@/components/Shell";
import { ConnectGate } from "@/components/ConnectGate";
import { Login } from "@/components/Login";
import { OnboardingGate } from "@/components/OnboardingGate";
import { hasOnboarded, markOnboarded } from "@/lib/onboarding";
import { startSyncLoop } from "@/lib/sync";
import { useVehicles } from "@/features/vehicle/queries";
import { signOut, useSession } from "@/features/account/useSession";
import { resolveVehicleView } from "@/lib/vehicle-view";
import { Skeleton } from "@/components/ui";
import { useT } from "@/i18n";
import { Overview } from "@/views/Overview";
import { Live } from "@/views/Live";
import { Diagnose } from "@/views/Diagnose";
import { Lab } from "@/views/Lab";
import { Workshop } from "@/views/Workshop";
import type { ConnStatus, Live as LiveMap } from "@scainner/core";

// Code-split: three.js/@react-three (~450KB gzip) loads only when a scene
// actually mounts (login carousel, connect gate, overview, vehicle).
const Vehicle = lazy(() => import("@/views/Vehicle").then((m) => ({ default: m.Vehicle })));
const DiscoveryFlow = lazy(() =>
  import("@/components/DiscoveryFlow").then((m) => ({ default: m.DiscoveryFlow })),
);

// The gates, in order: language (once ever) → sign-in (until signed in, or
// skipped for this session) → connect (until the first connect of this
// session, or "browse saved cars") → the shell.
type Stage = "onboarding" | "login" | "connect" | "shell";

export default function App() {
  const queryClient = useQueryClient();
  const t = useT();
  const [view, setView] = useState<ViewKey>("overview");
  const [conn, setConn] = useState<ConnStatus>({ state: "disconnected" });
  const [live, setLive] = useState<LiveMap>({});
  const staleTimer = useRef<number | null>(null);

  const [discoverVin, setDiscoverVin] = useState<string | null>(null);
  // Sticky for the app session: once connected, later disconnects stay in
  // the shell instead of falling back to the connect gate.
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);
  const [browsingOffline, setBrowsingOffline] = useState(false);
  const [onboarded, setOnboarded] = useState(() => hasOnboarded());
  // Sign-in is for sync; "continue without an account" is a per-session choice.
  const session = useSession();
  const [offlineOk, setOfflineOk] = useState(false);

  useEffect(() => {
    void import("@/components/DiscoveryFlow");
    startSyncLoop();
    runPromise(Effect.flatMap(DeviceService, (device) => device.connStatus()))
      .then(setConn)
      .catch(() => {});
    const un1 = listen<ConnStatus>("conn-status", (e) => {
      setConn(e.payload);
      // Invalidate everything on connect, nothing on live-update.
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

  // Both state updates in the SAME effect so Shell and DiscoveryFlow mount
  // in one render — the overlay covers the dashboard's first frame.
  useEffect(() => {
    if (conn.state !== "connected") return;
    if (conn.vehicle_is_new && conn.vin) setDiscoverVin(conn.vin);
    setHasConnectedOnce(true);
  }, [conn.state, conn.vehicle_is_new, conn.vin]);

  const vehicles = useVehicles();
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const connectedVehicleId = conn.vehicle_id ?? null;
  useEffect(() => {
    if (connectedVehicleId != null) setSelectedVehicleId(connectedVehicleId);
  }, [connectedVehicleId]);
  const connected = conn.state === "connected";
  const { viewVehicleId, liveEnabled, browsing } = resolveVehicleView({
    connected,
    connectedVehicleId,
    selectedVehicleId,
    knownVehicleIds: (vehicles.data ?? []).map((v) => v.id),
  });
  // Browsing offline with nothing selected: default to the first stored car.
  const currentVehicleId = viewVehicleId ?? (browsingOffline ? (vehicles.data?.[0]?.id ?? null) : null);
  const currentVin =
    currentVehicleId === connectedVehicleId
      ? (conn.vin ?? null)
      : ((vehicles.data ?? []).find((v) => v.id === currentVehicleId)?.vin ?? null);
  const currentVehicle = (vehicles.data ?? []).find((v) => v.id === currentVehicleId);
  const currentName = currentVehicle?.display_name || currentVehicle?.vin || conn.display_name || null;
  const recording = connected && Object.keys(live).length > 0;

  const connect = () => runPromise(Effect.flatMap(DeviceService, (device) => device.connect()));
  const disconnect = () => runPromise(Effect.flatMap(DeviceService, (device) => device.disconnect()));
  const continueFromLogin = useCallback(() => setOfflineOk(true), []);

  const stage: Stage | null = !onboarded
    ? "onboarding"
    : session === undefined
      ? null
      : !session && !offlineOk
        ? "login"
        : !hasConnectedOnce && !browsingOffline
          ? "connect"
          : "shell";

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        {stage === "onboarding" && (
          <OnboardingGate
            key="onboarding"
            onDone={() => {
              markOnboarded();
              setOnboarded(true);
            }}
          />
        )}
        {stage === "login" && <Login key="login" onContinue={continueFromLogin} />}
        {stage === "connect" && (
          <ConnectGate
            key="connect"
            conn={conn}
            onConnect={connect}
            canBrowse={(vehicles.data?.length ?? 0) > 0}
            onBrowseOffline={() => setBrowsingOffline(true)}
          />
        )}
      </AnimatePresence>

      {stage === "shell" && (
        <Shell
          view={view}
          onNavigate={setView}
          conn={conn}
          recording={recording}
          onConnect={connect}
          onDisconnect={disconnect}
          vehicles={vehicles.data ?? []}
          activeVehicleId={currentVehicleId}
          onSelectVehicle={setSelectedVehicleId}
          browsing={browsing}
          onReturnConnected={() => setSelectedVehicleId(connectedVehicleId)}
          onSignOut={session ? () => void signOut() : undefined}
          liveLabel={connected && liveEnabled && currentName ? `${currentName} · ${t.shell.switcher.connectedNote}` : null}
        >
          {view === "overview" && <Overview connState={conn.state} vehicleId={currentVehicleId} vin={currentVin} />}
          {view === "diagnose" && <Diagnose connected={liveEnabled} vehicleId={currentVehicleId} />}
          {view === "live" && (
            <Live live={live} connected={liveEnabled} scanning={conn.scanning ?? false} connState={conn.state} vehicleId={currentVehicleId} />
          )}
          {view === "workshop" && <Workshop connectedVehicleId={currentVehicleId} />}
          {view === "lab" && <Lab connected={liveEnabled} vehicleId={currentVehicleId} scanning={conn.scanning ?? false} />}
          {view === "vehicle" && (
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <Vehicle connected={liveEnabled} vehicleId={currentVehicleId} />
            </Suspense>
          )}
        </Shell>
      )}

      {discoverVin && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-bg" />}>
          <DiscoveryFlow
            vin={discoverVin}
            onDone={() => {
              setDiscoverVin(null);
              queryClient.invalidateQueries({ queryKey: ["list_vehicles"] });
              queryClient.invalidateQueries({ queryKey: ["vehicle_report"] });
            }}
          />
        </Suspense>
      )}
    </>
  );
}
