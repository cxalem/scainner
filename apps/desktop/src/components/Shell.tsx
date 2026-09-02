import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Archive,
  Car,
  ChevronsUpDown,
  Clock,
  FlaskConical,
  Gauge,
  LogOut,
  Plug,
  Stethoscope,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import { Wordmark } from "@/brand";
import { Banner, Button, Dot, LiveChip, PageHeader, Pill, Seg, useCyclingLabel } from "@/components/ui";
import { UpdateBanner } from "@/components/UpdateBanner";
import { Page, Reveal } from "@/motion/components";
import { appearVariants } from "@/motion";
import type { ConnStatus } from "@scainner/core";
import { useLocale, useT, type Locale } from "@/i18n";

export type ViewKey = "overview" | "diagnose" | "live" | "workshop" | "lab" | "vehicle";

export type VehicleOption = { id: number; vin: string | null; display_name: string | null };

const NAV_ICON: Record<ViewKey, LucideIcon> = {
  overview: Gauge,
  diagnose: Stethoscope,
  live: Activity,
  workshop: Wrench,
  lab: FlaskConical,
  vehicle: Car,
};
const PRIMARY: ViewKey[] = ["overview", "diagnose", "live", "workshop"];
const ADVANCED: ViewKey[] = ["lab", "vehicle"];

export function Shell({
  view,
  onNavigate,
  conn,
  recording,
  onConnect,
  onDisconnect,
  vehicles = [],
  activeVehicleId = null,
  onSelectVehicle,
  browsing = false,
  onReturnConnected,
  badges,
  onSignOut,
  liveLabel,
  children,
}: {
  view: ViewKey;
  onNavigate: (v: ViewKey) => void;
  conn: ConnStatus;
  recording: boolean;
  onConnect: () => void;
  onDisconnect: () => Promise<unknown>;
  vehicles?: VehicleOption[];
  activeVehicleId?: number | null;
  onSelectVehicle?: (id: number | null) => void;
  browsing?: boolean;
  onReturnConnected?: () => void;
  badges?: Partial<Record<ViewKey, number>>;
  onSignOut?: () => void;
  liveLabel?: string | null;
  children: ReactNode;
}) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const connected = conn.state === "connected";
  const connecting = conn.state === "connecting";
  const connectLabel = useCyclingLabel(t.shell.connectPhrases, connecting, 700);
  const [disconnecting, setDisconnecting] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const doDisconnect = async () => {
    setDisconnecting(true);
    try {
      await onDisconnect();
    } finally {
      setDisconnecting(false);
    }
  };

  const vehicleName = (v: VehicleOption) => v.display_name || v.vin || t.shell.vehicleSwitcher.unnamed(v.id);
  const active = vehicles.find((v) => v.id === activeVehicleId) ?? null;
  const connectedVehicle = vehicles.find((v) => v.id === conn.vehicle_id) ?? null;
  const activeTitle = active
    ? vehicleName(active)
    : connected
      ? (conn.display_name || conn.vin || t.shell.vehicleSwitcher.unnamed(conn.vehicle_id ?? 0))
      : t.shell.vehicleSwitcher.label;
  const activeSub = browsing ? t.shell.switcher.fromDatabase : connected ? t.shell.switcher.connectedNote : t.shell.switcher.notConnected;
  const page = t.pages[view];

  const navItem = (key: ViewKey) => {
    const Icon = NAV_ICON[key];
    const on = view === key;
    const badge = badges?.[key];
    return (
      <button
        key={key}
        type="button"
        onClick={() => {
          onNavigate(key);
          setSwitcherOpen(false);
        }}
        aria-current={on ? "page" : undefined}
        className={cn(
          "relative flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px]",
          "transition-[background-color,color] duration-150 hover:bg-accent-800",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          on ? "bg-surface text-text shadow-sm" : "text-neutral-400",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", on ? "text-accent-400" : "text-neutral-600")} aria-hidden="true" />
        <span className="flex-1">{t.shell.nav[key]}</span>
        {badge != null && badge > 0 && (
          <Pill variant="warn" className="min-w-4 justify-center px-[5px] py-px text-[10px]">
            {badge}
          </Pill>
        )}
      </button>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text">
      <aside
        className="flex h-full shrink-0 flex-col border-r border-divider bg-accent-900"
        style={{ width: "var(--sidebar-width)" }}
      >
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <Wordmark size="md" className="text-text" markClassName="text-accent-400" />
          {MOCK_MODE && (
            <Pill variant="warn" className="ml-auto" title={t.shell.demoDataTooltip}>
              {t.shell.demoData}
            </Pill>
          )}
        </div>

        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => setSwitcherOpen((o) => !o)}
            aria-expanded={switcherOpen}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md border border-divider bg-surface px-[11px] py-[9px] text-left shadow-sm",
              "transition-colors duration-150 hover:border-accent-600",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            )}
          >
            <Dot tone={browsing || !connected ? "muted" : "ok"} glow={connected && !browsing} className="h-[7px] w-[7px]" />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate text-[13px]">{activeTitle}</span>
              <span className="text-[10.5px] text-neutral-500">{activeSub}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-neutral-600" aria-hidden="true" />
          </button>
          <Reveal when={switcherOpen && vehicles.length > 0}>
            <div className="mt-1.5 overflow-hidden rounded-md border border-divider bg-surface shadow-md">
              {vehicles.map((v) => {
                const isConnected = connected && v.id === conn.vehicle_id;
                const Icon = isConnected ? Plug : Clock;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      onSelectVehicle?.(v.id);
                      setSwitcherOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-neutral-900 px-[11px] py-[9px] text-left last:border-b-0",
                      "transition-colors hover:bg-accent-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                      v.id === activeVehicleId && "bg-accent-900",
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", isConnected ? "text-ok" : "text-neutral-600")} aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[12.5px]">{vehicleName(v)}</span>
                      <span className="text-[10.5px] text-neutral-500">
                        {isConnected ? t.shell.switcher.onCable : t.shell.switcher.storedNote}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Reveal>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3" aria-label="Main">
          <div className="flex flex-col gap-0.5 pb-2">
            <div className="px-2 pb-[5px] pt-2.5 text-[10px] uppercase tracking-[0.12em] text-neutral-600">{t.shell.navGroups.primary}</div>
            {PRIMARY.map(navItem)}
          </div>
          <div className="flex flex-col gap-0.5 pb-2">
            <div className="px-2 pb-[5px] pt-2.5 text-[10px] uppercase tracking-[0.12em] text-neutral-600">{t.shell.navGroups.advanced}</div>
            {ADVANCED.map(navItem)}
          </div>
        </nav>

        <div className="flex flex-col gap-2 border-t border-divider p-3">
          <div className="flex flex-col gap-[7px] rounded-md border border-divider bg-surface px-[11px] py-2.5">
            <div className="flex items-center gap-[7px]">
              <Dot tone={connected ? "ok" : connecting ? "warn" : "muted"} pulse={connected || connecting} />
              <span className="flex-1 truncate text-[11.5px] text-neutral-300">
                {connected
                  ? recording
                    ? t.shell.status.recording
                    : t.shell.status.connected
                  : connecting
                    ? t.shell.status.connecting
                    : t.shell.status.disconnected}
              </span>
            </div>
            <span className="num truncate text-[10.5px] text-neutral-500">
              {connected ? (conn.elm_version ?? t.shell.adapterFallback) : connecting ? connectLabel : t.shell.status.ignitionThenConnect}
            </span>
            {connected ? (
              <Button variant="ghost" size="sm" className="self-start px-2" onClick={doDisconnect} busy={disconnecting}>
                {disconnecting ? t.shell.disconnecting : t.shell.disconnect}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="self-start px-2" onClick={onConnect} busy={connecting}>
                {connecting ? t.shell.status.connecting : t.shell.connect}
              </Button>
            )}
            <AnimatePresence initial={false}>
              {conn.detail && conn.state === "disconnected" && (
                <motion.p
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={appearVariants}
                  className="text-[11px] leading-snug text-stop"
                >
                  {conn.detail}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-1.5">
            <Seg<Locale>
              size="xs"
              aria-label={t.shell.language}
              value={locale}
              onChange={setLocale}
              options={[
                { value: "en", label: "EN" },
                { value: "es", label: "ES" },
              ]}
            />
            <span className="flex-1" />
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                title={t.shell.signOut}
                aria-label={t.shell.signOut}
                className="flex rounded-sm p-1 text-neutral-500 transition-colors hover:text-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <LogOut className="h-[15px] w-[15px]" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <UpdateBanner />
        <Reveal when={browsing} mode="fade">
          <Banner
            tone="warn"
            icon={Archive}
            action={
              onReturnConnected && (
                <Button variant="ghost" size="sm" className="text-warn" onClick={onReturnConnected}>
                  {t.shell.archive.returnToConnected}
                  {connectedVehicle ? ` · ${vehicleName(connectedVehicle)}` : ""}
                </Button>
              )
            }
          >
            {t.shell.archive.browsing(active ? vehicleName(active) : "")}
          </Banner>
        </Reveal>
        <main className="min-h-0 flex-1 overflow-y-scroll px-[26px] pb-11 pt-6">
          <div className="mx-auto flex w-full flex-col gap-[18px]" style={{ maxWidth: "var(--content-max-width)" }}>
            <PageHeader
              kicker={page.kicker}
              title={page.title}
              lede={page.lede(t.shell.appName)}
              aside={liveLabel ? <LiveChip>{liveLabel}</LiveChip> : undefined}
            />
            <AnimatePresence mode="wait" initial={false}>
              <Page key={view} className="flex flex-col gap-4">
                {children}
              </Page>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
