// The first screen of connecting: the OBD devices this machine can see.
// Was a modal behind a "Choose adapter" button; it is now the gate's own
// opening state, so the common case is one tap on Connect.
//
// Presentational on purpose — the gate owns the selection, because it also
// needs the chosen device's name for the connecting screen and its path
// for the profile it saves.
import { useCallback, useEffect, useState } from "react";
import { Bluetooth, Cable, Usb } from "lucide-react";
import { Effect } from "effect";
import { AdapterProfile, DeviceService } from "@scainner/core";
import { runPromise } from "@/core/runtime";
import { Pill } from "@/components/ui";
import { cn } from "@/lib/utils";
import { deviceRows, preselectedDevice, type DeviceRow } from "@/lib/device-list";
import { useT } from "@/i18n";

/** Load the device list, keeping the user's selection across a refresh. */
export function useDeviceList() {
  const t = useT();
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = deviceRows(
        await runPromise(Effect.flatMap(DeviceService, (device) => device.listAdapters())),
      );
      setRows(next);
      setSelectedId((current) =>
        current && next.some((row) => row.id === current && row.selectable)
          ? current
          : preselectedDevice(next),
      );
    } catch {
      setRows([]);
      setSelectedId(null);
      setError(t.gate.deviceListFailed);
    } finally {
      setLoading(false);
    }
  }, [t.gate.deviceListFailed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  return { rows, selected, select: setSelectedId, loading, error, refresh };
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

export function DeviceList({
  rows,
  selectedId,
  onSelect,
  loading,
}: {
  rows: DeviceRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  const t = useT();
  const detail = (row: DeviceRow) => {
    if (row.kind === "paired_only") return t.gate.pairedNotConnected;
    const transport = row.kind === "bluetooth_serial" ? t.gate.transportBluetooth : t.gate.transportUsb;
    return `${transport} · ${row.path}`;
  };

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
        <Cable className="h-6 w-6 text-neutral-600" aria-hidden="true" />
        <span className="text-[13px] text-text">{loading ? t.gate.lookingForDevices : t.gate.noDevices}</span>
        {!loading && <span className="max-w-[38ch] text-[12px] leading-snug text-neutral-500">{t.gate.pairFirst}</span>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3" role="listbox" aria-label={t.gate.chooseDeviceTitle}>
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
