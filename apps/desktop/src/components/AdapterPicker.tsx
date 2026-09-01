import { useCallback, useEffect, useMemo, useState } from "react";
import { Bluetooth, Cable, RefreshCw } from "lucide-react";
import { Effect } from "effect";
import { AdapterProfile, DeviceService, type AdapterCandidate } from "@scainner/core";
import { runPromise } from "@/core/runtime";
import { Button, Dialog } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

const normalizedIdentity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function bluetoothAddressFor(serial: AdapterCandidate, candidates: AdapterCandidate[]) {
  const serialName = normalizedIdentity(serial.name.replace(/^cu\.|^tty\./, ""));
  const matches = candidates.filter((candidate) => {
    if (candidate.kind !== "bluetooth") return false;
    const bluetoothName = normalizedIdentity(candidate.name);
    return bluetoothName === serialName || bluetoothName.includes(serialName) || serialName.includes(bluetoothName);
  });
  return matches.length === 1 ? matches[0].id : null;
}

export function AdapterPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [candidates, setCandidates] = useState<AdapterCandidate[]>([]);
  const [profile, setProfile] = useState<AdapterProfile | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextCandidates, nextProfile] = await Promise.all([
        runPromise(Effect.flatMap(DeviceService, (device) => device.listAdapters())),
        runPromise(Effect.flatMap(DeviceService, (device) => device.adapterProfile())),
      ]);
      setCandidates(nextCandidates);
      setProfile(nextProfile);
      setSelected(nextProfile.path);
    } catch {
      setError(t.gate.adapterSaveFailed);
    } finally {
      setBusy(false);
    }
  }, [t.gate.adapterSaveFailed]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const serial = useMemo(() => candidates.filter((candidate) => candidate.kind === "serial"), [candidates]);
  const pairedOnly = useMemo(() => candidates.filter((candidate) => candidate.kind === "bluetooth"), [candidates]);

  const save = async () => {
    const candidate = serial.find((item) => item.id === selected);
    if (!candidate || !profile) return;
    setBusy(true);
    setError(null);
    try {
      await runPromise(Effect.flatMap(DeviceService, (device) => device.setAdapterProfile(new AdapterProfile({
        ...profile,
        kind: "elm_serial",
        path: candidate.id,
        bt_addr: bluetoothAddressFor(candidate, candidates),
        // Reconnect cycles are safe and needed when macOS removes an SPP
        // node. Unpair/re-pair is a separate destructive permission.
        allow_repair: false,
      }))));
      onClose();
    } catch {
      setError(t.gate.adapterSaveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.gate.adapterTitle}
      icon={Cable}
      iconTone="accent"
      width={520}
      actions={(
        <>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void load()} busy={busy}>{t.gate.refreshAdapters}</Button>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={!selected || busy}>{t.gate.useAdapter}</Button>
        </>
      )}
    >
      <p className="text-[12.5px] leading-relaxed text-neutral-500">{t.gate.adapterHelp}</p>
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {serial.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => setSelected(candidate.id)}
            className={cn(
              "flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
              selected === candidate.id ? "border-accent bg-accent/10" : "border-divider bg-bg hover:border-neutral-600",
            )}
          >
            <Cable className="h-4 w-4 shrink-0 text-accent-400" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-text">{candidate.name}</span>
              <span className="num block truncate text-[11px] text-neutral-500">{candidate.id}</span>
            </span>
          </button>
        ))}
        {serial.length === 0 && <p className="py-3 text-center text-[12.5px] text-neutral-500">{t.gate.noAdapters}</p>}
        {pairedOnly.map((candidate) => (
          <div key={candidate.id} className="flex items-center gap-3 rounded-md border border-divider px-3 py-2.5 opacity-70">
            <Bluetooth className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-text">{candidate.name}</span>
              <span className="block text-[11px] text-neutral-500">{t.gate.pairedNeedsPort}</span>
            </span>
          </div>
        ))}
      </div>
      {error && <p className="text-[12px] text-stop" role="alert">{error}</p>}
    </Dialog>
  );
}
