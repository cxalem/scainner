import { useState } from "react";
import type { UdsHit } from "@scainner/core";
import { useUdsModules } from "@/features/lab/queries";
import { DidReader } from "@/views/lab/DidReader";
import { ModuleFaults } from "@/views/lab/ModuleFaults";
import { ModuleManager, RemoveModuleButton } from "@/views/lab/ModuleManager";
import { ProbeManager } from "@/views/lab/ProbeManager";
import { RangeScanner } from "@/views/lab/RangeScanner";

/// Manufacturer-specific diagnostics (UDS beyond standard OBD2). Reads plus
/// one write: the fault clear in ModuleFaults, which runs on the write
/// safety rail (ConfirmWrite modal, confirmed flag, write history).
/// This component just owns the module selection shared across every card;
/// each card is its own focused component under `views/lab/`.
export function Lab({ connected }: { connected: boolean }) {
  const modulesQuery = useUdsModules();
  const modules = modulesQuery.data ?? [];
  const [mod, setMod] = useState("engine");
  const [probeCandidate, setProbeCandidate] = useState<UdsHit | null>(null);

  const selected = modules.find((m) => m.key === mod);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Lab</h1>
        <div className="flex items-center gap-2">
          <select
            aria-label="Module"
            className="h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={mod}
            onChange={(e) => setMod(e.target.value)}
          >
            {modules.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} ({m.req}→{m.resp}){m.builtin ? "" : " · custom"}
              </option>
            ))}
          </select>
          {selected && !selected.builtin && (
            <RemoveModuleButton module={selected} onRemoved={() => setMod("engine")} />
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Manufacturer-specific reads (UDS service 22) to modules beyond standard OBD. The only thing here that can
        change the car is the fault clear in Module faults, and it runs behind a confirmation and lands in the write
        history. Identified values become recorded probes. The four built-in modules use PSA/Citroën/Peugeot
        addresses. On any other brand, add your own module below with your ECU's CAN IDs.
      </p>

      <ModuleManager />
      <DidReader module={mod} connected={connected} />
      <RangeScanner module={mod} connected={connected} onProbeCandidate={setProbeCandidate} />
      <ProbeManager module={mod} candidate={probeCandidate} onCandidateHandled={() => setProbeCandidate(null)} />
      <ModuleFaults module={mod} label={selected?.label ?? mod} connected={connected} />
    </div>
  );
}
