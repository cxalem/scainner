import { useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { hex4, type UdsHit, type UdsProbe } from "@/lib/meta";
import { useAddProbe, useDeleteProbe, useListProbes, useToggleProbe } from "@/lib/queries";

const inputCls =
  "h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

const PROBE_FIELDS = [
  ["label", "text"],
  ["unit", "text"],
  ["offset", "number"],
  ["len", "number"],
  ["scale", "number"],
  ["bias", "number"],
] as const;

/// Turns a DID found via the range scanner into a recorded probe (polled
/// every ~30s while connected and written to the readings table like any
/// standard sensor), and manages the list of probes already saved.
export function ProbeManager({
  module,
  candidate,
  onCandidateHandled,
}: {
  module: string;
  candidate: UdsHit | null;
  onCandidateHandled: () => void;
}) {
  const probesQuery = useListProbes();
  const probes = probesQuery.data ?? [];
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
          id: 0,
          module,
          did: draft.did ?? 0,
          label: draft.label,
          unit: draft.unit ?? "",
          offset: draft.offset ?? 0,
          len: draft.len ?? 1,
          scale: draft.scale ?? 1,
          bias: draft.bias ?? 0,
          enabled: true,
        },
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

  const toggle = (p: UdsProbe) => {
    setRowError(null);
    toggleProbe.mutate(
      { id: p.id, enabled: !p.enabled },
      { onError: (e) => setRowError({ id: p.id, msg: String(e instanceof Error ? e.message : e) }) },
    );
  };

  const remove = (p: UdsProbe) => {
    setRowError(null);
    deleteProbe.mutate(
      { id: p.id },
      { onError: (e) => setRowError({ id: p.id, msg: String(e instanceof Error ? e.message : e) }) },
    );
  };

  return (
    <>
      {draft && (
        <Card>
          <CardHeader>
            <CardTitle>
              New probe from DID {hex4(draft.did ?? 0)} on {module}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2 text-sm">
            {PROBE_FIELDS.map(([field, type]) => (
              <label key={field} className="flex flex-col gap-1 text-xs text-muted-foreground">
                {field}
                <input
                  className={inputCls + " w-24 text-foreground"}
                  type={type}
                  step="any"
                  value={((draft as Record<string, unknown>)[field] as string | number | undefined) ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: type === "number" ? Number(e.target.value) : e.target.value })
                  }
                />
              </label>
            ))}
            <Button onClick={save} disabled={!draft.label || addProbe.isPending}>
              {addProbe.isPending ? "Saving…" : "Save probe"}
            </Button>
            <Button variant="ghost" onClick={cancel} disabled={addProbe.isPending}>
              Cancel
            </Button>
            {saveError && <p className="w-full text-xs text-destructive">{saveError}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recorded probes (polled every ~30 s while connected)</CardTitle>
        </CardHeader>
        <CardContent>
          {probesQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : probesQuery.isError ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span>Could not load probes.</span>
              <Button variant="outline" onClick={() => probesQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : probes.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet — scan, find something interesting, make it a probe.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {probes.map((p) => {
                const togglePending = toggleProbe.isPending && toggleProbe.variables?.id === p.id;
                const deletePending = deleteProbe.isPending && deleteProbe.variables?.id === p.id;
                return (
                  <li key={p.id} className="flex flex-col gap-0.5 border-b border-border/50 py-1.5 last:border-0">
                    <div className="flex items-center justify-between">
                      <span>
                        <span className="font-medium">{p.label}</span>{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {p.module}/22{hex4(p.did)} [{p.offset}..{p.offset + p.len}] ×{p.scale}+{p.bias} {p.unit}
                        </span>
                      </span>
                      <span className="flex gap-2">
                        <button
                          className="rounded text-xs text-primary hover:underline disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onClick={() => toggle(p)}
                          disabled={togglePending}
                        >
                          {togglePending ? "…" : p.enabled ? "disable" : "enable"}
                        </button>
                        <button
                          className="rounded text-xs text-destructive hover:underline disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                          onClick={() => remove(p)}
                          disabled={deletePending}
                        >
                          {deletePending ? "…" : "delete"}
                        </button>
                      </span>
                    </div>
                    {rowError?.id === p.id && <p className="text-xs text-destructive">{rowError.msg}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
