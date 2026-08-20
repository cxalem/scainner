import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import type { UdsModule } from "@/lib/meta";
import { useAddUdsModule, useDeleteUdsModule, useUdsModules } from "@/lib/queries";

const inputCls =
  "h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/// Lists built-in + custom UDS modules and lets the user add their own (any
/// brand's CAN request/response IDs) — the feature that makes the Lab work
/// beyond the four PSA defaults. Shares the `uds_modules` query with Lab.tsx
/// (same cache entry, no extra round trip) rather than taking the list as a
/// prop, so this card owns its own loading/error state independently.
export function ModuleManager() {
  const modulesQuery = useUdsModules();
  const modules = modulesQuery.data ?? [];
  const addModule = useAddUdsModule();
  const [addingModule, setAddingModule] = useState(false);
  const [draft, setDraft] = useState({ key: "", label: "", req: "", resp: "" });
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    const { key, label, req, resp } = draft;
    if (!key || !label || !req || !resp) return;
    addModule.mutate(
      { key: key.toLowerCase().replace(/\s+/g, "_"), label, req, resp },
      {
        onSuccess: () => {
          setDraft({ key: "", label: "", req: "", resp: "" });
          setAddingModule(false);
        },
        onError: (e) => setError(String(e instanceof Error ? e.message : e)),
      },
    );
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
        {modulesQuery.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : modulesQuery.isError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span>Could not load modules.</span>
            <Button variant="outline" onClick={() => modulesQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
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
        )}
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
              <Button onClick={save} disabled={!draft.key || !draft.label || !draft.req || !draft.resp || addModule.isPending}>
                {addModule.isPending ? "Saving…" : "Save"}
              </Button>
              <Button variant="ghost" onClick={() => setAddingModule(false)} disabled={addModule.isPending}>
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
  const deleteModule = useDeleteUdsModule();
  const [error, setError] = useState<string | null>(null);

  const remove = () => {
    setError(null);
    deleteModule.mutate(
      { key: module.key },
      {
        onSuccess: onRemoved,
        onError: (e) => setError(String(e instanceof Error ? e.message : e)),
      },
    );
  };

  return (
    <span className="flex items-center gap-1.5">
      <button
        className="rounded text-xs text-destructive hover:underline disabled:pointer-events-none disabled:opacity-50 transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        onClick={remove}
        disabled={deleteModule.isPending}
      >
        {deleteModule.isPending ? "removing…" : "remove"}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
