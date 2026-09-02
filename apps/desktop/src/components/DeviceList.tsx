import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bluetooth, Cable, Loader2, Radar, Usb } from "lucide-react";
import { Effect } from "effect";
import { AdapterProfile, DeviceService } from "@scainner/core";
import { runPromise } from "@/core/runtime";
import { Button, Kicker, Pill, inputClass } from "@/components/ui";
import { useToast } from "@/components/toast";
import { fadeVariants } from "@/motion";
import { Grow, Item, List } from "@/motion/components";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PIN,
  defaultPin,
  deviceRows,
  deviceScrollColumnClass,
  isPinRequired,
  listSections,
  nearbyRows,
  preselectedDevice,
  scanRow,
  type DeviceRow,
  type NearbyRow,
  type ScanState,
} from "@/lib/device-list";
import { useT } from "@/i18n";

const DISCOVER_SECONDS = 8;

export type Discovery = ReturnType<typeof useDeviceList>["discovery"];

export function useDeviceList() {
  const t = useT();
  const toast = useToast();
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nearby, setNearby] = useState<NearbyRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [pairingAddr, setPairingAddr] = useState<string | null>(null);
  const [pinAddr, setPinAddr] = useState<string | null>(null);
  const [pin, setPin] = useState(DEFAULT_PIN);
  const [pairError, setPairError] = useState<string | null>(null);

  const refresh = useCallback(
    async (preferBtAddr?: string) => {
      setLoading(true);
      setError(null);
      setNearby([]);
      setScanned(false);
      setScanError(null);
      setPinAddr(null);
      setPairError(null);
      try {
        const next = deviceRows(
          await runPromise(Effect.flatMap(DeviceService, (device) => device.listAdapters())),
        );
        setRows(next);
        const paired = preferBtAddr
          ? next.find(
              (row) => row.btAddr?.toLowerCase() === preferBtAddr.toLowerCase() && row.selectable,
            )
          : undefined;
        setSelectedId((current) => {
          if (paired) return paired.id;
          return current && next.some((row) => row.id === current && row.selectable)
            ? current
            : preselectedDevice(next);
        });
      } catch {
        setRows([]);
        setSelectedId(null);
        setError(t.gate.deviceListFailed);
      } finally {
        setLoading(false);
      }
    },
    [t.gate.deviceListFailed],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!scanning) return;
    setSecondsLeft(DISCOVER_SECONDS);
    const id = setInterval(() => setSecondsLeft((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(id);
  }, [scanning]);

  const discover = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    setPinAddr(null);
    setPairError(null);
    try {
      const found = await runPromise(
        Effect.flatMap(DeviceService, (device) => device.discoverAdapters(DISCOVER_SECONDS)),
      );
      setNearby(nearbyRows(found, rows));
    } catch {
      setNearby([]);
      setScanError(t.gate.discoveryUnavailable);
    } finally {
      setScanned(true);
      setScanning(false);
    }
  }, [rows, t.gate.discoveryUnavailable]);

  const rememberedPin = useCallback(async () => {
    try {
      const profile = await runPromise(
        Effect.flatMap(DeviceService, (device) => device.adapterProfile()),
      );
      return defaultPin(profile.pin);
    } catch {
      return DEFAULT_PIN;
    }
  }, []);

  const attempt = useCallback(
    async (addr: string, code: string | null) => {
      const pairedName = nearby.find((row) => row.addr === addr)?.label ?? null;
      setPairingAddr(addr);
      setPairError(null);
      try {
        await runPromise(
          Effect.flatMap(DeviceService, (device) => device.pairAdapter(addr, code)),
        );
        if (code) await savePairingPin(code);
        await refresh(addr);
        toast.show("success", t.gate.paired(pairedName ?? addr));
      } catch (failure) {
        if (code === null && isPinRequired(failure)) {
          setPinAddr(addr);
          setPin(await rememberedPin());
        } else {
          setPairError(t.gate.pairFailed);
        }
      } finally {
        setPairingAddr(null);
      }
    },
    [nearby, refresh, rememberedPin, t, toast],
  );

  const pair = useCallback((addr: string) => attempt(addr, null), [attempt]);

  const confirmPair = useCallback(async () => {
    if (pinAddr) await attempt(pinAddr, pin);
  }, [attempt, pin, pinAddr]);

  const cancelPair = useCallback(() => {
    setPinAddr(null);
    setPairError(null);
  }, []);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const scan: ScanState = { scanning, scanned, error: scanError, found: nearby.length };
  return {
    rows,
    selected,
    select: setSelectedId,
    loading,
    error,
    refresh,
    discovery: {
      nearby,
      scan,
      secondsLeft,
      discover,
      pair,
      pairingAddr,
      pinAddr,
      pin,
      setPin,
      pairError,
      confirmPair,
      cancelPair,
    },
  };
}

export async function saveDeviceProfile(row: DeviceRow) {
  const profile = await runPromise(
    Effect.flatMap(DeviceService, (device) => device.adapterProfile()),
  );
  await runPromise(
    Effect.flatMap(DeviceService, (device) =>
      device.setAdapterProfile(
        new AdapterProfile({ ...profile, kind: "elm_serial", path: row.path, bt_addr: row.btAddr }),
      ),
    ),
  );
}

async function savePairingPin(pin: string) {
  const profile = await runPromise(
    Effect.flatMap(DeviceService, (device) => device.adapterProfile()),
  );
  await runPromise(
    Effect.flatMap(DeviceService, (device) =>
      device.setAdapterProfile(new AdapterProfile({ ...profile, pin })),
    ),
  );
}

export function DeviceList({
  rows,
  selectedId,
  onSelect,
  loading,
  discovery,
}: {
  rows: DeviceRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  discovery: Discovery;
}) {
  const t = useT();
  const showNearby = listSections(discovery.scan).includes("nearby");

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-divider px-3 py-2">
        <Kicker className="flex-1">{t.gate.devicesHeading}</Kicker>
        <Button
          variant="secondary"
          size="sm"
          icon={Radar}
          busy={discovery.scan.scanning}
          disabled={loading}
          onClick={() => void discovery.discover()}
        >
          {t.gate.discoverDevices}
        </Button>
      </div>

      <div className={deviceScrollColumnClass}>
        <Grow when={showNearby} className="pb-3">
          <NearbyGroup discovery={discovery} />
        </Grow>
        {rows.length > 0 ? (
          <PairedRows rows={rows} selectedId={selectedId} onSelect={onSelect} />
        ) : (
          <EmptyDevices loading={loading} compact={showNearby} />
        )}
      </div>
    </div>
  );
}

function PairedRows({
  rows,
  selectedId,
  onSelect,
}: {
  rows: DeviceRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const detail = (row: DeviceRow) => {
    if (row.kind === "paired_only") return t.gate.pairedNotConnected;
    const transport = row.kind === "bluetooth_serial" ? t.gate.transportBluetooth : t.gate.transportUsb;
    return `${transport} · ${row.path}`;
  };

  return (
    <div className="flex shrink-0 flex-col gap-2" role="listbox" aria-label={t.gate.chooseDeviceTitle}>
      {rows.map((row) => {
        const selected = row.id === selectedId;
        const Icon = row.kind === "usb_serial" ? Usb : Bluetooth;
        return (
          <button
            key={row.id}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={!row.selectable}
            onClick={() => onSelect(row.id)}
            className={cn(
              "flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              selected ? "border-accent bg-accent/10" : "border-divider bg-bg hover:border-neutral-600",
              !row.selectable && "pointer-events-none opacity-55",
            )}
          >
            <Icon
              className={cn("h-4 w-4 shrink-0", row.selectable ? "text-accent-400" : "text-neutral-500")}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-text">{row.name}</span>
              <span className="num block truncate text-[11px] text-neutral-500">{detail(row)}</span>
            </span>
            {row.lastUsed && (
              <Pill variant="info" className="shrink-0">
                {t.gate.lastUsed}
              </Pill>
            )}
          </button>
        );
      })}
    </div>
  );
}

function EmptyDevices({ loading, compact }: { loading: boolean; compact: boolean }) {
  const t = useT();
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 px-6 text-center",
        compact ? "py-3" : "flex-1 justify-center",
      )}
    >
      <Cable className="h-6 w-6 text-neutral-600" aria-hidden="true" />
      <span className="text-[13px] text-text">{loading ? t.gate.lookingForDevices : t.gate.noDevices}</span>
      {!loading && (
        <span className="max-w-[38ch] text-[12px] leading-snug text-neutral-500">{t.gate.pairFirst}</span>
      )}
    </div>
  );
}

function NearbyGroup({ discovery }: { discovery: Discovery }) {
  const t = useT();
  const { nearby, scan, secondsLeft, pairingAddr, pinAddr } = discovery;
  const status = scanRow(scan);

  const note =
    status === "scanning" ? (
      <>
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {secondsLeft > 0 ? t.gate.scanningSeconds(secondsLeft) : t.gate.scanning}
      </>
    ) : status === "error" ? (
      scan.error
    ) : status === "empty" ? (
      t.gate.noNearby
    ) : null;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-dashed border-divider p-2.5">
      <h2 className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">{t.gate.nearby}</h2>

      <div className="grid empty:hidden" aria-live="polite">
        <AnimatePresence initial={false}>
          {note && (
            <motion.p
              key={status}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={fadeVariants}
              className={cn(
                "col-start-1 row-start-1 flex items-center gap-2 text-[12px] leading-snug",
                status === "empty" ? "text-neutral-500" : "text-neutral-400",
              )}
            >
              {note}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <List className="flex flex-col gap-2 empty:hidden">
        {nearby.map((row) => (
          <Item
            key={row.addr}
            className="flex flex-col gap-2 rounded-md border border-divider bg-bg px-3 py-2.5"
          >
            <div className="flex items-center gap-3">
              <Bluetooth className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-text">{row.label}</span>
                <span className="num block truncate text-[11px] text-neutral-500">{row.addr}</span>
              </span>
              <Button
                size="sm"
                busy={pairingAddr === row.addr}
                disabled={pairingAddr != null}
                onClick={() => void discovery.pair(row.addr)}
              >
                {pairingAddr === row.addr ? t.gate.pairing : t.gate.pair}
              </Button>
            </div>

            {pinAddr === row.addr && (
              <PinField
                addr={row.addr}
                pin={discovery.pin}
                onPin={discovery.setPin}
                pairing={pairingAddr === row.addr}
                error={discovery.pairError}
                onConfirm={() => void discovery.confirmPair()}
                onCancel={discovery.cancelPair}
              />
            )}
          </Item>
        ))}
      </List>
    </section>
  );
}

function PinField({
  addr,
  pin,
  onPin,
  pairing,
  error,
  onConfirm,
  onCancel,
}: {
  addr: string;
  pin: string;
  onPin: (pin: string) => void;
  pairing: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const id = `pair-pin-${addr}`;
  return (
    <div
      className="flex flex-col gap-2 border-t border-divider pt-2.5"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className="text-[12px] leading-snug text-text">{t.gate.pinRequired}</p>
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={id} className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">
            {t.gate.pinLabel}
          </label>
          <input
            id={id}
            value={pin}
            autoFocus
            inputMode="numeric"
            autoComplete="off"
            maxLength={16}
            disabled={pairing}
            onChange={(e) => onPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm();
            }}
            className={cn(inputClass, "num w-[7.5rem] tracking-[0.2em]")}
          />
        </div>
        <Button variant="primary" size="sm" busy={pairing} onClick={onConfirm} className="h-9">
          {pairing ? t.gate.pairing : t.gate.pair}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pairing} className="h-9">
          {t.common.cancel}
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-neutral-500">{t.gate.pinHint}</p>
      {error && (
        <p className="text-[12px] leading-snug text-stop" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
