import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Shell, type ViewKey } from "@/components/Shell";
import { Overview } from "@/views/Overview";
import { Live } from "@/views/Live";
import { History } from "@/views/History";
import { Diagnose } from "@/views/Diagnose";
import { Lab } from "@/views/Lab";
import { Vehicle } from "@/views/Vehicle";
import type { ConnStatus, Live as LiveMap } from "@/lib/meta";

export default function App() {
  const [view, setView] = useState<ViewKey>("overview");
  const [conn, setConn] = useState<ConnStatus>({ state: "disconnected" });
  const [live, setLive] = useState<LiveMap>({});
  const staleTimer = useRef<number | null>(null);

  useEffect(() => {
    invoke<ConnStatus>("conn_status").then(setConn).catch(() => {});
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

  const connected = conn.state === "connected";
  const recording = connected && Object.keys(live).length > 0;

  return (
    <Shell
      view={view}
      onNavigate={setView}
      conn={conn}
      recording={recording}
      onConnect={() => invoke("connect")}
      onDisconnect={() => invoke("disconnect")}
    >
      {view === "overview" && <Overview />}
      {view === "live" && <Live live={live} connected={connected} />}
      {view === "history" && <History />}
      {view === "diagnose" && <Diagnose connected={connected} />}
      {view === "lab" && <Lab connected={connected} />}
      {view === "vehicle" && <Vehicle connected={connected} />}
    </Shell>
  );
}
