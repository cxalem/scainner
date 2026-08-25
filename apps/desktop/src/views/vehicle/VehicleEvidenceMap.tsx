import { Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { useVehicleEvidenceMap } from "@/features/vehicle/queries";
import { useT } from "@/i18n";

export function VehicleEvidenceMap({ vehicleId }: { vehicleId: number | null }) {
  const t = useT();
  const query = useVehicleEvidenceMap(vehicleId);
  const map = query.data;

  const sourceLabel = (source: string | null) => {
    if (source === "ecu_reported") return t.vehicle.map.nameSource.ecu;
    if (source === "ecu_reported_identity") return t.vehicle.map.nameSource.identity;
    if (source === "documented_profile") return t.vehicle.map.nameSource.documented;
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Network className="h-4 w-4" aria-hidden="true" /> {t.vehicle.map.cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">{t.vehicle.map.explainer}</p>
        {vehicleId == null ? (
          <p className="text-muted-foreground">{t.vehicle.map.noVehicle}</p>
        ) : query.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : map == null || map.modules.length === 0 ? (
          <p className="text-muted-foreground">{t.vehicle.map.noModules}</p>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t.vehicle.map.moduleCount(map.modules.length)}
            </p>
            <div className="flex flex-col gap-2">
              {map.modules.map((module) => {
                const source = sourceLabel(module.name_source);
                return (
                  <details key={module.id} className="rounded-md border bg-card open:bg-muted/20">
                    <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr_auto] items-center gap-x-2 px-3 py-2.5 marker:content-none">
                      <span className="font-mono text-xs">{module.address}</span>
                      <span className="truncate font-medium">{module.display_name ?? t.vehicle.map.unknownModule}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.vehicle.map.identity(module.identity.fields_answered, module.identity.fields_total)}
                      </span>
                      <span className="col-start-2 col-end-4 text-xs text-muted-foreground">
                        {t.vehicle.map.previouslyReached}
                        {source != null ? ` · ${source}` : ""}
                        {` · ${t.vehicle.map.values(module.dids.length)}`}
                      </span>
                    </summary>
                    <div className="flex flex-col gap-3 border-t px-3 py-3 text-xs">
                      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr_auto_1fr]">
                        <span className="text-muted-foreground">{t.vehicle.map.firstSeen}</span>
                        <span className="font-mono">{module.first_seen_at}</span>
                        <span className="text-muted-foreground">{t.vehicle.map.lastSeen}</span>
                        <span className="font-mono">{module.last_seen_at}</span>
                      </div>
                      <div className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
                        {module.identity.spare_part_number != null && <><span>F187</span><span className="font-mono">{module.identity.spare_part_number}</span></>}
                        {module.identity.hardware_version != null && <><span>F191</span><span className="font-mono">{module.identity.hardware_version}</span></>}
                        {module.identity.software_version != null && <><span>F195</span><span className="font-mono">{module.identity.software_version}</span></>}
                        {module.identity.system_name != null && <><span>F197</span><span className="font-mono">{module.identity.system_name}</span></>}
                      </div>
                      {module.dids.length > 0 && (
                        <div className="max-h-52 overflow-auto rounded border">
                          {module.dids.map((did) => (
                            <div key={did.did} className="grid grid-cols-[4rem_1fr_auto] gap-2 border-b px-2 py-1.5 last:border-b-0">
                              <span className="font-mono">{did.did.toString(16).toUpperCase().padStart(4, "0")}</span>
                              <span>{did.label ?? t.vehicle.map.raw}</span>
                              <span className="max-w-48 truncate font-mono text-muted-foreground" title={did.raw_sample ?? undefined}>
                                {did.raw_sample ?? "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-muted-foreground">{t.vehicle.map.moduleFaultsNotScanned}</p>
                    </div>
                  </details>
                );
              })}
            </div>
          </>
        )}
        <div className="border-t pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.vehicle.map.standardFaults}</p>
          {map?.latest_standard_faults == null ? (
            <p className="mt-1 text-xs text-muted-foreground">{t.vehicle.map.noStandardScan}</p>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-muted-foreground">{map.latest_standard_faults.scanned_at}</span>
              <span>{t.vehicle.map.standardFaultCount(
                map.latest_standard_faults.stored.length + map.latest_standard_faults.pending.length + map.latest_standard_faults.permanent.length,
              )}</span>
              {[...map.latest_standard_faults.stored, ...map.latest_standard_faults.pending, ...map.latest_standard_faults.permanent].map((code, index) => (
                <span key={`${code}-${index}`} className="rounded bg-muted px-1.5 py-0.5 font-mono">{code}</span>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
