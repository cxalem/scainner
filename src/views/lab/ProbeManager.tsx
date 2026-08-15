import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { hex4, type UdsHit, type UdsProbe } from "@/lib/meta";

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
  const [probes, setProbes] = useState<UdsProbe[]>([]);
  const [draft, setDraft] = useState<Partial<UdsProbe> | null>(null);

  const loadProbes = () => invoke<UdsProbe[]>("list_probes").then(setProbes).catch(() => {});
  useEffect(() => {
    loadProbes();
  }, []);
  useEffect(() => {
    if (candidate) setDraft({ did: candidate.did, len: 1, offset: 0, scale: 1, bias: 0 });
  }, [candidate]);

  const save = async () => {
    if (!draft?.label) return;
    await invoke("add_probe", {
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
    });
    setDraft(null);
    onCandidateHandled();
    loadProbes();
  };

  const cancel = () => {
    setDraft(null);
    onCandidateHandled();
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
            <Button onClick={save} disabled={!draft.label}>
              Save probe
            </Button>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recorded probes (polled every ~30 s while connected)</CardTitle>
        </CardHeader>
        <CardContent>
          {probes.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet — scan, find something interesting, make it a probe.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {probes.map((p) => (
                <li key={p.id} className="flex items-center justify-between border-b border-border/50 py-1.5 last:border-0">
                  <span>
                    <span className="font-medium">{p.label}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.module}/22{hex4(p.did)} [{p.offset}..{p.offset + p.len}] ×{p.scale}+{p.bias} {p.unit}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <button
                      className="rounded text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => invoke("toggle_probe", { id: p.id, enabled: !p.enabled }).then(loadProbes)}
                    >
                      {p.enabled ? "disable" : "enable"}
                    </button>
                    <button
                      className="rounded text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                      onClick={() => invoke("delete_probe", { id: p.id }).then(loadProbes)}
                    >
                      delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
