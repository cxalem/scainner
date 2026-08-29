import { useEffect, useState } from "react";
import type { UdsHit } from "@scainner/core";
import { useUdsModules } from "@/features/lab/queries";
import { DidReader } from "@/views/lab/DidReader";
import { ModuleFaults } from "@/views/lab/ModuleFaults";
import { AutoDiscovery } from "@/views/lab/AutoDiscovery";
import { ModuleManager, RemoveModuleButton } from "@/views/lab/ModuleManager";
import { ProbeManager } from "@/views/lab/ProbeManager";
import { RangeScanner } from "@/views/lab/RangeScanner";
import { ParkedVerification } from "@/views/lab/ParkedVerification";
import { GuidedCorrelation } from "@/views/lab/GuidedCorrelation";
import { useT } from "@/i18n";
import { defaultSweepBand, useParkedPlan } from "@/views/lab/plan";

/// Manufacturer-specific diagnostics (UDS beyond standard OBD2). Reads plus
/// one write: the fault clear in ModuleFaults, which runs on the write
/// safety rail (ConfirmWrite modal, confirmed flag, write history).
/// This component just owns the module selection shared across every card;
/// each card is its own focused component under `views/lab/`.
export function Lab({
  connected,
  vehicleId = null,
  scanning = false,
}: {
  connected: boolean;
  vehicleId?: number | null;
  scanning?: boolean;
}) {
  const t = useT();
  const modulesQuery = useUdsModules();
  const modules = modulesQuery.data ?? [];
  // No module key is a code constant (multi-brand plan P4.3): the default
  // is the first module the knowledge map documents for the connected VIN,
  // else the first custom one, else nothing.
  const firstModule = (modules.find((m) => m.builtin) ?? modules[0])?.key ?? "";
  const [mod, setMod] = useState("");
  useEffect(() => {
    if (!modules.some((m) => m.key === mod)) setMod(firstModule);
  }, [modules, mod, firstModule]);
  const plan = useParkedPlan(vehicleId);
  const [probeCandidate, setProbeCandidate] = useState<UdsHit | null>(null);

  const selected = modules.find((m) => m.key === mod);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{t.lab.title}</h1>
        <div className="flex items-center gap-2">
          <select
            aria-label={t.lab.moduleAriaLabel}
            className="h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={mod}
            onChange={(e) => setMod(e.target.value)}
          >
            {modules.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} ({m.req}→{m.resp}){m.builtin ? "" : t.lab.customSuffix}
              </option>
            ))}
          </select>
          {selected && !selected.builtin && (
            <RemoveModuleButton module={selected} onRemoved={() => setMod(firstModule)} />
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t.lab.explainer}</p>

      <AutoDiscovery connected={connected} vehicleId={vehicleId} scanning={scanning} />
      <ParkedVerification connected={connected} vehicleId={vehicleId} />
      <GuidedCorrelation connected={connected} vehicleId={vehicleId} />

      {/* Manual tools, demoted below auto-discovery: for a brand it
          doesn't cover yet, for reading a specific address by hand, or
          for extending the knowledge map with a real find (owner
          decision 2026-08-24 — keep them, but they're no longer the
          primary path). */}
      <h2 className="text-sm font-medium text-muted-foreground">{t.lab.advanced.title}</h2>
      <p className="-mt-2 text-xs text-muted-foreground">{t.lab.advanced.explainer}</p>
      <ModuleManager />
      <DidReader module={mod} connected={connected} />
      <RangeScanner module={mod} connected={connected} defaultRange={defaultSweepBand(plan.data, mod)} onProbeCandidate={setProbeCandidate} />
      <ProbeManager
        module={mod}
        candidate={probeCandidate}
        onCandidateHandled={() => setProbeCandidate(null)}
        vehicleId={vehicleId}
      />
      <ModuleFaults module={mod} label={selected?.label ?? mod} connected={connected} />
    </div>
  );
}
