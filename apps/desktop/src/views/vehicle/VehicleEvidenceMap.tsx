// The module-level evidence map: every module this car has answered from,
// its identity fields, the values observed, and the last standard fault
// scan. Only persisted observations — unknown stays unknown.
import { useState } from "react";
import { ChevronDown, ChevronRight, Network } from "lucide-react";
import { Card, CardHead, ExpanderButton, Kicker, Mono, Note, Pill, Skeleton } from "@/components/ui";
import { Reveal } from "@/motion/components";
import { useVehicleEvidenceMap } from "@/features/vehicle/queries";
import { useT } from "@/i18n";

export function VehicleEvidenceMap({ vehicleId }: { vehicleId: number | null }) {
  const t = useT();
  const query = useVehicleEvidenceMap(vehicleId);
  const map = query.data;
  const [open, setOpen] = useState<number | null>(null);

  const sourceLabel = (source: string | null) => {
    if (source === "ecu_reported") return t.vehicle.map.nameSource.ecu;
    if (source === "ecu_reported_identity") return t.vehicle.map.nameSource.identity;
    if (source === "documented_profile") return t.vehicle.map.nameSource.documented;
    return null;
  };

  const faults = map?.latest_standard_faults;
  const faultCodes = faults ? [...faults.stored, ...faults.pending, ...faults.permanent] : [];

  return (
    <Card flush>
      <CardHead divided icon={Network} title={t.vehicle.map.cardTitle} aside={map ? t.vehicle.map.moduleCount(map.modules.length) : undefined} />
      <div className="flex flex-col gap-2.5 px-[17px] py-[13px]">
        <Note className="text-[12px]">{t.vehicle.map.explainer}</Note>
        {vehicleId == null ? (
          <Note>{t.vehicle.map.noVehicle}</Note>
        ) : query.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : map == null || map.modules.length === 0 ? (
          <Note>{t.vehicle.map.noModules}</Note>
        ) : (
          <div className="flex flex-col">
            {map.modules.map((module) => {
              const source = sourceLabel(module.name_source);
              const isOpen = open === module.id;
              return (
                <div key={module.id} className="flex flex-col border-b border-neutral-900 last:border-b-0">
                  <ExpanderButton open={isOpen} onClick={() => setOpen(isOpen ? null : module.id)} className="w-full gap-3 py-2.5 text-left text-text">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-600" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-600" />}
                    {/* min-w, not w, and shrink-0: extended module routing
                        (e.g. "6A8/688") is longer than a 2-char address —
                        a fixed w with no shrink guard lets it paint over
                        the name column instead of reserving its own space. */}
                    <Mono className="min-w-7 shrink-0 text-[12px] text-neutral-500">{module.address}</Mono>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px]">{module.display_name ?? t.vehicle.map.unknownModule}</span>
                      <span className="text-[11.5px] text-neutral-500">
                        {t.vehicle.map.previouslyReached}
                        {source != null ? ` · ${source}` : ""}
                        {` · ${t.vehicle.map.values(module.dids.length)}`}
                      </span>
                    </span>
                    <Pill variant={module.identity.fields_answered > 0 ? "verified" : "standard"}>
                      {t.vehicle.map.identity(module.identity.fields_answered, module.identity.fields_total)}
                    </Pill>
                  </ExpanderButton>
                  <Reveal when={isOpen}>
                    <div className="flex flex-col gap-3 pb-3.5 pl-[34px] text-[12px]">
                      <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-1">
                        <span className="text-neutral-500">{t.vehicle.map.firstSeen}</span>
                        <Mono>{module.first_seen_at}</Mono>
                        <span className="text-neutral-500">{t.vehicle.map.lastSeen}</span>
                        <Mono>{module.last_seen_at}</Mono>
                      </div>
                      {(module.identity.spare_part_number || module.identity.hardware_version || module.identity.software_version || module.identity.system_name) && (
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                          {module.identity.spare_part_number != null && (<><Mono className="text-neutral-500">F187</Mono><Mono>{module.identity.spare_part_number}</Mono></>)}
                          {module.identity.hardware_version != null && (<><Mono className="text-neutral-500">F191</Mono><Mono>{module.identity.hardware_version}</Mono></>)}
                          {module.identity.software_version != null && (<><Mono className="text-neutral-500">F195</Mono><Mono>{module.identity.software_version}</Mono></>)}
                          {module.identity.system_name != null && (<><Mono className="text-neutral-500">F197</Mono><Mono>{module.identity.system_name}</Mono></>)}
                        </div>
                      )}
                      {module.dids.length > 0 && (
                        <div className="max-h-52 overflow-auto rounded-md border border-divider">
                          {module.dids.map((did) => (
                            <div key={did.did} className="grid grid-cols-[4rem_1fr_auto] gap-2 border-b border-neutral-900 px-2.5 py-1.5 last:border-b-0">
                              <Mono>{did.did.toString(16).toUpperCase().padStart(4, "0")}</Mono>
                              <span>{did.label ?? t.vehicle.map.raw}</span>
                              <Mono className="max-w-48 truncate text-neutral-500" title={did.raw_sample ?? undefined}>{did.raw_sample ?? "—"}</Mono>
                            </div>
                          ))}
                        </div>
                      )}
                      <Note className="text-[11.5px]">{t.vehicle.map.moduleFaultsNotScanned}</Note>
                    </div>
                  </Reveal>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-col gap-1.5 border-t border-divider pt-3">
          <Kicker>{t.vehicle.map.standardFaults}</Kicker>
          {faults == null ? (
            <Note className="text-[12px]">{t.vehicle.map.noStandardScan}</Note>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Mono className="text-neutral-500">{faults.scanned_at}</Mono>
              <span>{t.vehicle.map.standardFaultCount(faultCodes.length)}</span>
              {faultCodes.map((code, index) => (
                <Pill key={`${code}-${index}`} variant={faults.mil_on ? "warn" : "info"} className="num">{code}</Pill>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
