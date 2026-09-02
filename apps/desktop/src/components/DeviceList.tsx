// The first screen of connecting: the OBD devices this machine can see.
// Was a modal behind a "Choose adapter" button; it is now the gate's own
// opening state, so the common case is one tap on Connect.
//
// A dongle out of the box is not in that list yet, so the screen can also
// scan for radios in range and pair the one the user picks — scan, tap,
// paired, and it is an ordinary row ready to connect. The scan is a first-
// class action in the card's own header, and its results land above the
// paired rows, because a 230 px card cannot ask the user to go looking for
// what they just clicked. Scan results are UI state only: Refresh clears
// them, and only a real pairing turns one into a row.
//
// Pairing sends no PIN (Brief K, 2026-09-02). Secure Simple Pairing is what
// current dongles use and an already-paired radio needs nothing at all, so
// the field only appears when the radio itself asks — the backend's
// `pin_required` answer — and the attempt is then retried with the code.
//
// The Nearby group OPENS rather than appears (Brief M, 2026-09-02): it
// grows from nothing to its own measured height, so the paired rows below
// are carried down by the growth instead of being shoved. The same
// measurement keeps following the group afterwards, so the countdown
// becoming a result — or a PIN field opening on a row — resizes it smoothly
// too. See <Grow> in motion/components.tsx.
//
// Presentational on purpose — the gate owns the selection, because it also
// needs the chosen device's name for the connecting screen and its path
// for the profile it saves.
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bluetooth, Cable, Loader2, Radar, Usb } from "lucide-react";
import { Effect } from "effect";
import { AdapterProfile, DeviceService } from "@scainner/core";
import { runPromise } from "@/core/runtime";
import { Button, Kicker, Pill, inputClass } from "@/components/ui";
import { fadeVariants } from "@/motion";
import { Grow, Item, List } from "@/motion/components";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PIN,
  defaultPin,
  deviceRows,
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
  const [secondsLeft, setSecondsLeft] = useState(0);
  // The address a pairing attempt is out on, and the one whose radio asked
  // for a PIN — two different things, so a device can be pairing without a
  // field open and holding a field open without an attempt running.
  const [pairingAddr, setPairingAddr] = useState<string | null>(null);
  const [pinAddr, setPinAddr] = useState<string | null>(null);
  const [pin, setPin] = useState(DEFAULT_PIN);
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

  // The countdown under the spinner. Costs one interval while the inquiry
  // is out and nothing at all the rest of the time — a scan the user can
  // see the end of is a scan they will wait through.
  useEffect(() => {
    if (!scanning) return;
    setSecondsLeft(DISCOVER_SECONDS);
    const id = setInterval(() => setSecondsLeft((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(id);
  }, [scanning]);

  /** Scan the air for radios that are not paired yet. Runs alongside the
   *  list rather than replacing it — the paired rows stay usable while the
   *  8 s inquiry is out. */
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

  /** The PIN that worked for the last dongle is a better opening guess than
   *  the generic default, and it costs one read to know it. */
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

  /** One pairing attempt. `code` is null for the first try — which is all
   *  Secure Simple Pairing needs — and the radio asking for a PIN is the
   *  only failure that opens the field instead of reporting an error. A
   *  failed retry *with* a code is an ordinary failure: the code was wrong. */
  const attempt = useCallback(
    async (addr: string, code: string | null) => {
      setPairingAddr(addr);
      setPairError(null);
      try {
        await runPromise(
          Effect.flatMap(DeviceService, (device) => device.pairAdapter(addr, code)),
        );
        if (code) await savePairingPin(code);
        // Re-enumerate: the paired radio is a device row now, and the scan
        // results it came from are stale.
        await refresh(addr);
      } catch (failure) {
        if (code === null && isPinRequired(failure)) {
          setPinAddr(addr);
          setPin(await rememberedPin());
        } else {
          // The field stays open on the failing row so the PIN can be
          // retried without scanning again.
          setPairError(t.gate.pairFailed);
        }
      } finally {
        setPairingAddr(null);
      }
    },
    [refresh, rememberedPin, t.gate.pairFailed],
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
  const showNearby = listSections(discovery.scan).includes("nearby");

  return (
    <div className="flex h-full flex-col">
      {/* The scan is the answer whenever the dongle is not in the list yet,
          so it is the card's own header action rather than a ghost button
          under everything the user would have to scroll past. */}
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

      {/* No `gap` on this column: the space under the Nearby group belongs
          to the group, so it collapses with it instead of leaving a gap
          behind when the group closes. */}
      <div className="flex flex-1 flex-col overflow-y-auto p-3">
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

/** The devices the machine already has: the only rows Connect can act on. */
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
  );
}

/** Nothing paired yet. The way out is the Discover button in the header
 *  above, which is why this says what it says. */
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

/** The scan's own group: quieter than the paired rows (a dashed rule, no
 *  accent) because nothing in it is connectable yet — but above them, so
 *  the spinner and then the results are where the click was. */
function NearbyGroup({ discovery }: { discovery: Discovery }) {
  const t = useT();
  const { nearby, scan, secondsLeft, pairingAddr, pinAddr } = discovery;
  const status = scanRow(scan);
  const statusRef = useRef<HTMLElement>(null);

  // A list taller than the 230 px card would otherwise hide the very thing
  // the click just started. Bring the scan's own row into view instead.
  useEffect(() => {
    if (!scan.scanning) return;
    statusRef.current?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [scan.scanning]);

  // The one line the scan owns. Keyed by `status`, so the countdown ticking
  // down redraws in place and only a real change of state cross-fades.
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
    <section
      ref={statusRef}
      className="flex flex-col gap-2 rounded-md border border-dashed border-divider p-2.5"
    >
      <h2 className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">{t.gate.nearby}</h2>

      {/* One grid cell for every state of the line, so the countdown and
          what replaces it cross-fade over each other rather than one
          pushing the other down. The group's own height follows. */}
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

/** The PIN step, opened only by a radio that asked for one. Enter pairs,
 *  Escape closes — the row is small enough that reaching for the buttons
 *  should be optional. */
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
