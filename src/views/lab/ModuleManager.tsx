import { useState } from "react";
import { invoke } from "@/lib/tauri";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import type { UdsModule } from "@/lib/meta";

const inputCls =
  "h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/// Lists built-in + custom UDS modules and lets the user add their own (any
/// brand's CAN request/response IDs) — the feature that makes the Lab work
/// beyond the four PSA defaults.
export function ModuleManager({
  modules,
  onModulesChanged,
}: {
  modules: UdsModule[];
  onModulesChanged: () => void;
}) {
  const [addingModule, setAddingModule] = useState(false);
  const [draft, setDraft] = useState({ key: "", label: "", req: "", resp: "" });
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const { key, label, req, resp } = draft;
    if (!key || !label || !req || !resp) return;
    try {
      await invoke("add_uds_module", { key: key.toLowerCase().replace(/\s+/g, "_"), label, req, resp });
      setDraft({ key: "", label: "", req: "", resp: "" });
      setAddingModule(false);
      onModulesChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Modules</span>
          {!addingModule && (
            <Button variant="outline" onClick={() => setAddingModule(true)}>
              Add module
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-sm">
          {modules.map((m) => (
            <li key={m.key} className="flex items-center justify-between border-b border-border/50 py-1 last:border-0">
              <span>
                {m.label} <span className="font-mono text-xs text-muted-foreground">{m.req}→{m.resp}</span>
              </span>
              <span className="text-xs text-muted-foreground">{m.builtin ? "built-in" : "custom"}</span>
            </li>
          ))}
        </ul>
        {addingModule && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              Find your car's UDS request/response CAN IDs (car-hacking forums, community projects for your
              brand — see the README) and add them here. Same read-only rules apply.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Name
                <input
                  className={inputCls + " w-40 text-foreground"}
                  placeholder="e.g. TCM"
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Key (unique)
                <input
                  className={inputCls + " w-28 text-foreground"}
                  placeholder="tcm"
                  value={draft.key}
                  onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Request CAN ID (hex)
                <input
                  className={inputCls + " w-24 text-foreground"}
                  placeholder="7E0"
                  value={draft.req}
                  onChange={(e) => setDraft({ ...draft, req: e.target.value.toUpperCase() })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Response CAN ID (hex)
                <input
                  className={inputCls + " w-24 text-foreground"}
                  placeholder="7E8"
                  value={draft.resp}
                  onChange={(e) => setDraft({ ...draft, resp: e.target.value.toUpperCase() })}
                />
              </label>
              <Button onClick={save} disabled={!draft.key || !draft.label || !draft.req || !draft.resp}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => setAddingModule(false)}>
                Cancel
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RemoveModuleButton({ module, onRemoved }: { module: UdsModule; onRemoved: () => void }) {
  const remove = async () => {
    await invoke("delete_uds_module", { key: module.key });
    onRemoved();
  };
  return (
    <button
      className="rounded text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
      onClick={remove}
    >
      remove
    </button>
  );
}
