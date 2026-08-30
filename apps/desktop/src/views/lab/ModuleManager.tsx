// Add a module route by hand (any brand's CAN request/response IDs).
// Routes normally come from the brand pack; this is research use. Shares
// the `uds_modules` query with Lab.tsx (same cache entry).
import { useState } from "react";
import { Button, Card, Input, Mono, Note, Skeleton } from "@/components/ui";
import { Reveal } from "@/motion/components";
import type { UdsModule } from "@scainner/core";
import { useAddUdsModule, useDeleteUdsModule, useUdsModules } from "@/features/lab/queries";
import { useT } from "@/i18n";

export function ModuleManager() {
  const t = useT();
  const m = t.lab.moduleManager;
  const modulesQuery = useUdsModules();
  const modules = modulesQuery.data ?? [];
  const addModule = useAddUdsModule();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ key: "", label: "", req: "", resp: "" });
  const [error, setError] = useState<string | null>(null);

  const complete = !!(draft.key && draft.label && draft.req && draft.resp);
  const save = () => {
    setError(null);
    if (!complete) return;
    addModule.mutate(
      { key: draft.key.toLowerCase().replace(/\s+/g, "_"), label: draft.label, req: draft.req, resp: draft.resp },
      {
        onSuccess: () => {
          setDraft({ key: "", label: "", req: "", resp: "" });
          setAdding(false);
        },
        onError: (e) => setError(String(e instanceof Error ? e.message : e)),
      },
    );
  };

  return (
    <Card className="gap-[9px] px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[13px]">{t.lab.drawer.addRoute}</span>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            {m.addModule}
          </Button>
        )}
      </div>
      {modulesQuery.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : modulesQuery.isError ? (
        <div className="flex items-center gap-2 text-[12.5px] text-stop">
          <span>{m.couldNotLoad}</span>
          <Button size="sm" onClick={() => modulesQuery.refetch()}>
            {t.common.retry}
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col">
          {modules.map((mod) => (
            <li key={mod.key} className="flex items-center gap-2 border-b border-neutral-900 py-1 text-[12.5px] last:border-0">
              <span className="min-w-0 flex-1 truncate">
                {mod.label} <Mono className="text-[11.5px] text-neutral-500">{mod.req}→{mod.resp}</Mono>
              </span>
              <span className="text-[11px] text-neutral-500">{mod.builtin ? m.builtin : m.custom}</span>
            </li>
          ))}
        </ul>
      )}
      <Reveal when={adding}>
        <div className="flex flex-col gap-2 rounded-md bg-bg p-2.5">
          <Note className="text-[11.5px]">{m.addExplainer}</Note>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder={m.fieldNamePlaceholder} aria-label={m.fieldName} className="text-[12.5px]" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            <Input placeholder="tcm" aria-label={m.fieldKey} className="num text-[12.5px]" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
            <Input placeholder="7E0" aria-label={m.fieldReq} className="num text-[12.5px]" value={draft.req} onChange={(e) => setDraft({ ...draft, req: e.target.value.toUpperCase() })} />
            <Input placeholder="7E8" aria-label={m.fieldResp} className="num text-[12.5px]" value={draft.resp} onChange={(e) => setDraft({ ...draft, resp: e.target.value.toUpperCase() })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={addModule.isPending}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" size="sm" onClick={save} busy={addModule.isPending} disabled={!complete}>
              {addModule.isPending ? m.saving : m.save}
            </Button>
          </div>
          {error && <p className="text-[12px] text-stop">{error}</p>}
        </div>
      </Reveal>
      <Note className="text-[11.5px]">{t.lab.drawer.routeNote}</Note>
    </Card>
  );
}

export function RemoveModuleButton({ module, onRemoved }: { module: UdsModule; onRemoved: () => void }) {
  const t = useT();
  const deleteModule = useDeleteUdsModule();
  const [error, setError] = useState<string | null>(null);

  const remove = () => {
    setError(null);
    deleteModule.mutate({ key: module.key }, { onSuccess: onRemoved, onError: (e) => setError(String(e instanceof Error ? e.message : e)) });
  };

  return (
    <span className="flex items-center gap-1.5">
      <Button variant="destructive" size="sm" onClick={remove} busy={deleteModule.isPending}>
        {deleteModule.isPending ? t.lab.moduleManager.removing : t.lab.moduleManager.remove}
      </Button>
      {error && <span className="text-[12px] text-stop">{error}</span>}
    </span>
  );
}
