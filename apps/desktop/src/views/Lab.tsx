import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Hand, ListChecks, Wand2 } from "lucide-react";
import type { DiscoveryStatus, UdsHit } from "@scainner/core";
import { useUdsModules } from "@/features/lab/queries";
import { Card, ChoiceCard, ExpanderButton, Select } from "@/components/ui";
import { Block, Reveal, Swap } from "@/motion/components";
import { DidReader } from "@/views/lab/DidReader";
import { ModuleFaults } from "@/views/lab/ModuleFaults";
import { AutoDiscovery } from "@/views/lab/AutoDiscovery";
import { AutoScanState } from "@/views/lab/AutoScanState";
import { ModuleManager, RemoveModuleButton } from "@/views/lab/ModuleManager";
import { ProbeManager } from "@/views/lab/ProbeManager";
import { RangeScanner } from "@/views/lab/RangeScanner";
import { ParkedVerification } from "@/views/lab/ParkedVerification";
import { GuidedCorrelation } from "@/views/lab/GuidedCorrelation";
import { useT } from "@/i18n";
import { defaultSweepBand, useParkedPlan } from "@/views/lab/plan";

type Mode = "auto" | "plan" | "guided";

export function Lab({
  connected,
  vehicleId = null,
  scanning = false,
  discovery = null,
}: {
  connected: boolean;
  vehicleId?: number | null;
  scanning?: boolean;
  discovery?: DiscoveryStatus | null;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("auto");
  const [advOpen, setAdvOpen] = useState(false);

  const modulesQuery = useUdsModules();
  const modules = modulesQuery.data ?? [];
  const firstModule = (modules.find((m) => m.builtin) ?? modules[0])?.key ?? "";
  const [mod, setMod] = useState("");
  useEffect(() => {
    if (!modules.some((m) => m.key === mod)) setMod(firstModule);
  }, [modules, mod, firstModule]);
  const plan = useParkedPlan(vehicleId);
  const [probeCandidate, setProbeCandidate] = useState<UdsHit | null>(null);
  const selected = modules.find((m) => m.key === mod);

  const modes: { id: Mode; icon: typeof Wand2; label: string; note: string }[] = [
    { id: "auto", icon: Wand2, ...t.lab.modes.auto },
    { id: "plan", icon: ListChecks, ...t.lab.modes.plan },
    { id: "guided", icon: Hand, ...t.lab.modes.guided },
  ];

  return (
    <>
      <Block>
        <AutoScanState vehicleId={vehicleId} discovery={discovery} />
      </Block>

      <Block>
        <Card flush>
          <div className="flex gap-[9px] px-[17px] pt-[15px]">
            {modes.map((m) => (
              <ChoiceCard key={m.id} active={mode === m.id} icon={m.icon} label={m.label} note={m.note} onClick={() => setMode(m.id)} />
            ))}
          </div>
          <Swap k={mode}>
            {mode === "auto" && <AutoDiscovery connected={connected} vehicleId={vehicleId} scanning={scanning} />}
            {mode === "plan" && <ParkedVerification connected={connected} vehicleId={vehicleId} />}
            {mode === "guided" && <GuidedCorrelation connected={connected} vehicleId={vehicleId} />}
          </Swap>
        </Card>
      </Block>

      <Block>
        <ExpanderButton open={advOpen} onClick={() => setAdvOpen((o) => !o)}>
          {advOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
          {advOpen ? t.lab.drawer.hide : t.lab.drawer.show}
        </ExpanderButton>
        <Reveal when={advOpen}>
          <div className="mt-2.5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-neutral-500">
              <span>{t.lab.drawer.moduleFor}</span>
              <Select
                aria-label={t.lab.moduleAriaLabel}
                className="num w-auto min-h-8 py-1 text-[12.5px]"
                value={mod}
                onChange={(e) => setMod(e.target.value)}
              >
                {modules.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.req}→{m.resp}){m.builtin ? "" : t.lab.customSuffix}
                  </option>
                ))}
              </Select>
              {selected && !selected.builtin && <RemoveModuleButton module={selected} onRemoved={() => setMod(firstModule)} />}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DidReader module={mod} connected={connected} />
              <RangeScanner
                module={mod}
                connected={connected}
                defaultRange={defaultSweepBand(plan.data, mod)}
                onProbeCandidate={setProbeCandidate}
              />
              <ModuleManager />
              <ProbeManager
                module={mod}
                candidate={probeCandidate}
                onCandidateHandled={() => setProbeCandidate(null)}
                vehicleId={vehicleId}
              />
              <ModuleFaults module={mod} label={selected?.label ?? mod} connected={connected} />
            </div>
          </div>
        </Reveal>
      </Block>
    </>
  );
}
