// The first screen of connecting: the OBD devices this machine can see.
// Was a modal behind a "Choose adapter" button; it is now the gate's own
// opening state, so the common case is one tap on Connect.
//
// A dongle out of the box is not in that list yet, so the screen can also
// scan for radios in range and pair the one the user picks — scan, tap,
// PIN, paired, and it is an ordinary row ready to connect. Scan results are
// UI state only: Refresh clears them, and only a real pairing turns one
// into a row.
//
// Presentational on purpose — the gate owns the selection, because it also
// needs the chosen device's name for the connecting screen and its path
// for the profile it saves.
import { useCallback, useEffect, useState } from "react";
import { Bluetooth, Cable, Loader2, Usb } from "lucide-react";
import { Effect } from "effect";
import { AdapterProfile, DeviceService } from "@scainner/core";
import { runPromise } from "@/core/runtime";
import { Button, Pill, inputClass } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PIN,
  defaultPin,
  deviceRows,
  nearbyRows,
  preselectedDevice,
  type DeviceRow,
  type NearbyRow,
} from "@/lib/device-list";
import { useT } from "@/i18n";

/** How long the radio inquiry runs. The backend clamps to 3..15; 8 s is
 *  long enough for a dongle that has just been powered up and short enough
 *  to wait through. */
const DISCOVER_SECONDS = 8;

/** Everything the Nearby group needs, so the gate passes one object down
 *  instead of a dozen props. */
export type Discovery = ReturnType<typeof useDeviceList>["discovery"];

/** Load the device list, keeping the user's selection across a refresh, and
 *  own the scan/pair state that sits under it. */
export function useDeviceList() {
  const t = useT();
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scan results live only as long as the list they were found against.
  const [nearby, setNearby] = useState<NearbyRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [pairAddr, setPairAddr] = useState<string | null>(null);
  const [pin, setPin] = useState(DEFAULT_PIN);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  /** `preferBtAddr` is the radio just paired: it should be the selected row
   *  the moment the OS exposes its serial node. */
  const refresh = useCallback(
    async (preferBtAddr?: string) => {
      setLoading(true);
      setError(null);
      setNearby([]);
      setScanned(false);
      setScanError(null);
      setPairAddr(null);
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

  /** Scan the air for radios that are not paired yet. Runs alongside the
   *  list rather than replacing it — the paired rows stay usable while the
   *  8 s inquiry is out. */
  const discover = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    setPairAddr(null);
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

  const beginPair = useCallback(async (addr: string) => {
    setPairAddr(addr);
    setPairError(null);
    // The PIN that worked for the last dongle is the better opening guess
    // than the generic default, and it costs one read to know it.
    try {
      const profile = await runPromise(
        Effect.flatMap(DeviceService, (device) => device.adapterProfile()),
      );
      setPin(defaultPin(profile.pin));
    } catch {
      setPin(DEFAULT_PIN);
    }
  }, []);

  const cancelPair = useCallback(() => {
    setPairAddr(null);
    setPairError(null);
  }, []);

  const confirmPair = useCallback(async () => {
    if (!pairAddr) return;
    setPairing(true);
    setPairError(null);
    try {
      await runPromise(Effect.flatMap(DeviceService, (device) => device.pairAdapter(pairAddr, pin)));
      await savePairingPin(pin);
      // Re-enumerate: the paired radio is a device row now, and the scan
      // results it came from are stale.
      await refresh(pairAddr);
    } catch {
      // The field stays open on the failing row so the PIN can be retried
      // without scanning again.
      setPairError(t.gate.pairFailed);
    } finally {
      setPairing(false);
    }
  }, [pairAddr, pin, refresh, t.gate.pairFailed]);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  return {
    rows,
    selected,
    select: setSelectedId,
    loading,
    error,
    refresh,
    discovery: {
      nearby,
      scanning,
      scanned,
      error: scanError,
      discover,
      pairAddr,
      pin,
      setPin,
      pairing,
      pairError,
      beginPair,
      cancelPair,
      confirmPair,
    },
  };
}

/** Save the chosen device as the adapter profile, keeping every field the
 *  picker does not own (pin, baud, timing). The connect pipeline brings
 *  `bt_addr`'s link up when the platform reports it down; nothing pairs or
 *  unpairs anything. */
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

/** Remember the PIN a pairing actually accepted, so the connect pipeline
 *  and the next dongle out of the same box both start from it. A merge over
 *  the current profile: nothing else here is the picker's to change. */
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
  const detail = (row: DeviceRow) => {
    if (row.kind === "paired_only") return t.gate.pairedNotConnected;
    const transport = row.kind === "bluetooth_serial" ? t.gate.transportBluetooth : t.gate.transportUsb;
    return `${transport} · ${row.path}`;
  };

  // The group only exists once a scan has been asked for; before that the
  // screen is exactly what it was.
  const showNearby = discovery.scanning || discovery.scanned || discovery.nearby.length > 0;

  if (rows.length === 0 && !showNearby) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
        <Cable className="h-6 w-6 text-neutral-600" aria-hidden="true" />
        <span className="text-[13px] text-text">{loading ? t.gate.lookingForDevices : t.gate.noDevices}</span>
        {!loading && <span className="max-w-[38ch] text-[12px] leading-snug text-neutral-500">{t.gate.pairFirst}</span>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {rows.length > 0 && (
        <div className="flex flex-col gap-2" role="listbox" aria-label={t.gate.chooseDeviceTitle}>
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
      )}

      {showNearby && <NearbyGroup discovery={discovery} />}
    </div>
  );
}

/** The scan's own group, under the paired rows: quieter than they are (a
 *  dashed rule, no accent) because nothing in it is connectable yet. */
function NearbyGroup({ discovery }: { discovery: Discovery }) {
  const t = useT();
  const { nearby, scanning, error, pairAddr, pairing } = discovery;
  const empty = !scanning && !error && nearby.length === 0;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-dashed border-divider p-2.5">
      <h2 className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">{t.gate.nearby}</h2>

      <div aria-live="polite">
        {scanning && (
          <p className="flex items-center gap-2 text-[12px] text-neutral-400">
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {t.gate.scanning}
          </p>
        )}
        {error && <p className="text-[12px] leading-snug text-neutral-400">{error}</p>}
        {empty && <p className="text-[12px] leading-snug text-neutral-500">{t.gate.noNearby}</p>}
      </div>

      {nearby.map((row) => (
        <div key={row.addr} className="flex flex-col gap-2 rounded-md border border-divider bg-bg px-3 py-2.5">
          <div className="flex items-center gap-3">
            <Bluetooth className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-text">{row.label}</span>
              <span className="num block truncate text-[11px] text-neutral-500">{row.addr}</span>
            </span>
            <Button
              size="sm"
              onClick={() => void discovery.beginPair(row.addr)}
              disabled={pairing || pairAddr === row.addr}
            >
              {t.gate.pair}
            </Button>
          </div>

          {pairAddr === row.addr && (
            <PinField
              addr={row.addr}
              pin={discovery.pin}
              onPin={discovery.setPin}
              pairing={pairing}
              error={discovery.pairError}
              onConfirm={() => void discovery.confirmPair()}
              onCancel={discovery.cancelPair}
            />
          )}
        </div>
      ))}
    </section>
  );
}

/** The inline PIN step. Enter pairs, Escape closes — the row is small
 *  enough that reaching for the buttons should be optional. */
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
