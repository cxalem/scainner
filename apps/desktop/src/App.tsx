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
import { Toaster } from "@/components/ui/sonner";
import { useT } from "@/i18n";
import { Overview } from "@/views/Overview";
import { Live } from "@/views/Live";
import { Diagnose } from "@/views/Diagnose";
import { Lab } from "@/views/Lab";
import { Workshop } from "@/views/Workshop";
import type { ConnStatus, Live as LiveMap } from "@scainner/core";

const Vehicle = lazy(() => import("@/views/Vehicle").then((m) => ({ default: m.Vehicle })));
const DiscoveryFlow = lazy(() =>
  import("@/components/DiscoveryFlow").then((m) => ({ default: m.DiscoveryFlow })),
);

type Stage = "onboarding" | "login" | "connect" | "shell";

export default function App() {
  const queryClient = useQueryClient();
  const t = useT();
  const [view, setView] = useState<ViewKey>("overview");
  const [conn, setConn] = useState<ConnStatus>({ state: "disconnected" });
  const [live, setLive] = useState<LiveMap>({});
  const staleTimer = useRef<number | null>(null);

  const [discoverVin, setDiscoverVin] = useState<string | null>(null);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);
  const [browsingOffline, setBrowsingOffline] = useState(false);
  const [onboarded, setOnboarded] = useState(() => hasOnboarded());
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
      if (e.payload.state === "connected") void queryClient.invalidateQueries();
    });
    const un2 = listen<LiveMap>("live-update", (e) => {
      setLive((prev) => ({ ...prev, ...e.payload }));
      if (staleTimer.current) window.clearTimeout(staleTimer.current);
      staleTimer.current = window.setTimeout(() => setLive({}), 10000);
    });
    const un3 = listen("dtc-scan", () => {
      void queryClient.invalidateQueries({ queryKey: ["dtc_history"] });
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
      un3.then((f) => f());
    };
  }, [queryClient]);

  useEffect(() => {
    if (conn.state !== "connected") return;
    if (conn.vehicle_is_new && conn.vin) {
      setDiscoverVin(conn.vin);
      setHasConnectedOnce(true);
    }
  }, [conn.state, conn.vehicle_is_new, conn.vin]);
  const continueToDashboard = useCallback(() => setHasConnectedOnce(true), []);

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
  const currentVehicleId = viewVehicleId ?? (browsingOffline ? (vehicles.data?.[0]?.id ?? null) : null);
  const currentVin =
    currentVehicleId === connectedVehicleId
      ? (conn.vin ?? null)
      : ((vehicles.data ?? []).find((v) => v.id === currentVehicleId)?.vin ?? null);
  const currentVehicle = (vehicles.data ?? []).find((v) => v.id === currentVehicleId);
  const currentName = currentVehicle?.display_name || currentVehicle?.vin || conn.display_name || null;
  const recording = connected && Object.keys(live).length > 0;
  const onConnectedCarDiscovery = liveEnabled ? (conn.discovery ?? null) : null;

  const connect = () => runPromise(Effect.flatMap(DeviceService, (device) => device.connect()));
  const disconnect = async () => {
    await runPromise(Effect.flatMap(DeviceService, (device) => device.disconnect()));
    setHasConnectedOnce(false);
  };
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
            onContinue={continueToDashboard}
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
          {view === "overview" && (
            <Overview
              connState={conn.state}
              vehicleId={currentVehicleId}
              vin={currentVin}
              discovery={onConnectedCarDiscovery}
              onNavigate={setView}
            />
          )}
          {view === "diagnose" && <Diagnose connected={liveEnabled} vehicleId={currentVehicleId} />}
          {view === "live" && (
            <Live
              live={live}
              connected={liveEnabled}
              scanning={conn.scanning ?? false}
              discovery={onConnectedCarDiscovery}
              connState={conn.state}
              vehicleId={currentVehicleId}
              onNavigate={setView}
            />
          )}
          {view === "workshop" && <Workshop connectedVehicleId={currentVehicleId} />}
          {view === "lab" && (
            <Lab
              connected={liveEnabled}
              vehicleId={currentVehicleId}
              scanning={conn.scanning ?? false}
              discovery={onConnectedCarDiscovery}
            />
          )}
          {view === "vehicle" && (
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <Vehicle connected={liveEnabled} vehicleId={currentVehicleId} />
            </Suspense>
          )}
        </Shell>
      )}

      <Toaster closeLabel={t.common.close} />

      {discoverVin && (
        <Suspense
          fallback={
            <div
              className="fixed inset-0 z-50"
              style={{ background: "radial-gradient(60% 50% at 50% 0%, var(--accent-900), var(--bg) 70%)" }}
            />
          }
        >
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
