// Polled probes: turns a DID found by hand into a recorded probe (polled
// every ~30 s while connected, written to readings like any standard
// sensor) and manages the ones already saved. Only probes the user created
// explicitly — auto-discovered definitions are inventory, not telemetry.
import { useEffect, useState } from "react";
import { Button, Card, Input, Mono, Note, Skeleton } from "@/components/ui";
import { List, Item, Reveal } from "@/motion/components";
import { hex4 } from "@/shared/domain/gauges";
import type { UdsHit, UdsProbe } from "@scainner/core";
import { useAddProbe, useDeleteProbe, useListProbes, useToggleProbe } from "@/features/lab/queries";
import { useT } from "@/i18n";

// Raw UdsProbe schema field names, untranslated on purpose (same idiom as
// hex CAN IDs/DIDs).
const PROBE_FIELDS = [
  ["label", "text"],
  ["unit", "text"],
  ["offset", "number"],
  ["len", "number"],
  ["scale", "number"],
  ["bias", "number"],
] as const;

export function ProbeManager({
  module,
  candidate,
  onCandidateHandled,
  vehicleId,
}: {
  module: string;
  candidate: UdsHit | null;
  onCandidateHandled: () => void;
  vehicleId: number | null;
}) {
  const t = useT();
  const p = t.lab.probeManager;
  const probesQuery = useListProbes(vehicleId);
  const probes = (probesQuery.data ?? []).filter((probe) => (probe.origin ?? "manual") === "manual");
  const addProbe = useAddProbe();
  const toggleProbe = useToggleProbe();
  const deleteProbe = useDeleteProbe();
  const [draft, setDraft] = useState<Partial<UdsProbe> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: number; msg: string } | null>(null);

  useEffect(() => {
    if (candidate) setDraft({ did: candidate.did, len: 1, offset: 0, scale: 1, bias: 0 });
  }, [candidate]);

  const save = () => {
    if (!draft?.label) return;
    setSaveError(null);
    addProbe.mutate(
      {
        probe: {
          id: 0, module, did: draft.did ?? 0, label: draft.label, unit: draft.unit ?? "",
          offset: draft.offset ?? 0, len: draft.len ?? 1, scale: draft.scale ?? 1, bias: draft.bias ?? 0, enabled: true,
        },
        vehicleId,
      },
      {
        onSuccess: () => {
          setDraft(null);
          onCandidateHandled();
        },
        onError: (e) => setSaveError(String(e instanceof Error ? e.message : e)),
      },
    );
  };
  const cancel = () => {
    setDraft(null);
    onCandidateHandled();
  };
  const toggle = (probe: UdsProbe) => {
    setRowError(null);
    toggleProbe.mutate({ id: probe.id, enabled: !probe.enabled }, { onError: (e) => setRowError({ id: probe.id, msg: String(e instanceof Error ? e.message : e) }) });
  };
  const remove = (probe: UdsProbe) => {
    setRowError(null);
    deleteProbe.mutate({ id: probe.id }, { onError: (e) => setRowError({ id: probe.id, msg: String(e instanceof Error ? e.message : e) }) });
  };

  return (
    <Card className="gap-[9px] px-4 py-3.5">
      <span className="text-[13px]">{t.lab.drawer.polledProbes}</span>
      <Reveal when={draft != null}>
        {draft && (
          <div className="flex flex-col gap-2 rounded-md bg-bg p-2.5">
            <span className="text-[12.5px]">{p.newProbeTitle(hex4(draft.did ?? 0), module)}</span>
            <div className="grid grid-cols-3 gap-2">
              {PROBE_FIELDS.map(([field, type]) => (
                <label key={field} className="flex flex-col gap-1 text-[11px] text-neutral-500">
                  {field}
                  <Input
                    className="num min-h-8 py-1 text-[12px]"
                    type={type}
                    step="any"
                    value={((draft as Record<string, unknown>)[field] as string | number | undefined) ?? ""}
                    onChange={(e) => setDraft({ ...draft, [field]: type === "number" ? Number(e.target.value) : e.target.value })}
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={cancel} disabled={addProbe.isPending}>
                {t.common.cancel}
              </Button>
              <Button variant="primary" size="sm" onClick={save} busy={addProbe.isPending} disabled={!draft.label}>
                {addProbe.isPending ? p.saving : p.saveProbe}
              </Button>
            </div>
            {saveError && <p className="text-[12px] text-stop">{saveError}</p>}
          </div>
        )}
      </Reveal>
      {probesQuery.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : probesQuery.isError ? (
        <div className="flex items-center gap-2 text-[12.5px] text-stop">
          <span>{p.couldNotLoad}</span>
          <Button size="sm" onClick={() => probesQuery.refetch()}>
            {t.common.retry}
          </Button>
        </div>
      ) : probes.length === 0 ? (
        <Note className="text-[11.5px]">{p.noneYet}</Note>
      ) : (
        <List className="flex flex-col">
          {probes.map((probe) => {
            const togglePending = toggleProbe.isPending && toggleProbe.variables?.id === probe.id;
            const deletePending = deleteProbe.isPending && deleteProbe.variables?.id === probe.id;
            return (
              <Item key={probe.id} className="flex flex-col gap-0.5 border-b border-neutral-900 py-1.5 last:border-0">
                <div className="flex items-center gap-2 text-[12.5px]">
                  <Mono className="text-[11.5px] text-neutral-500">{probe.module}/22{hex4(probe.did)}</Mono>
                  <span className={`min-w-0 flex-1 truncate ${probe.enabled ? "" : "text-neutral-500"}`}>{probe.label}</span>
                  <Mono className="text-[11px] text-neutral-500">
                    [{probe.offset}..{probe.offset + probe.len}] ×{probe.scale}+{probe.bias} {probe.unit}
                  </Mono>
                  <Button variant="ghost" size="sm" onClick={() => toggle(probe)} busy={togglePending}>
                    {probe.enabled ? p.disable : p.enable}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => remove(probe)} busy={deletePending}>
                    {p.delete}
                  </Button>
                </div>
                {rowError?.id === probe.id && <p className="text-[12px] text-stop">{rowError.msg}</p>}
              </Item>
            );
          })}
        </List>
      )}
    </Card>
  );
}
