import { useState } from "react";
import { Effect } from "effect";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { Bot, Car, Copy, Database, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton, useTransientLabel } from "@/components/ui";
import { useDbPath, useReadEcuInfo, useVehicleInfo } from "@/features/vehicle/queries";
import { useT } from "@/i18n";

export function Vehicle({ connected, vehicleId = null }: { connected: boolean; vehicleId?: number | null }) {
  const t = useT();
  // The vehicles row (schema v2) — a real entity, not the old global
  // car_info key-value cache that could keep a previous car's identity.
  const infoQuery = useVehicleInfo(vehicleId);
  const vehicle = infoQuery.data ?? null;
  const info: Record<string, string> = vehicle
    ? (Object.fromEntries(
        Object.entries({
          name: vehicle.display_name,
          vin: vehicle.vin,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year != null ? String(vehicle.year) : null,
          fuel_price: String(vehicle.fuel_price),
          first_connected: vehicle.first_connected_at,
        }).filter(([, v]) => v != null),
      ) as Record<string, string>)
    : {};
  // A disabled query (vehicleId null) reports isPending forever — gate it.
  const infoLoading = vehicleId !== null && infoQuery.isPending;
  const dbPathQuery = useDbPath();
  const readEcu = useReadEcuInfo();

  // Raw JSON / AI briefing exports are one-shot documents, not cacheable
  // server state (same reasoning as ai.ts's report generation) — plain
  // invoke with local pending/error state, not the query layer. Sharing one
  // "which export is copying" flag across all three buttons is a small,
  // deliberate simplification over per-button pending state — logged in
  // decisions-build.md.
  const [copyingWhich, setCopyingWhich] = useState<string | null>(null);
  const [copyLabel, flashCopy] = useTransientLabel(2500);
  const [copyError, setCopyError] = useState<string | null>(null);

  const copyExport = async (hours: number, label: string) => {
    setCopyingWhich(label);
    setCopyError(null);
    try {
      const json = await runPromise(Effect.flatMap(DeviceService, (device) => device.exportJson(hours)));
      await navigator.clipboard.writeText(json);
      flashCopy(label);
    } catch (e) {
      setCopyError(String(e instanceof Error ? e.message : e));
    } finally {
      setCopyingWhich(null);
    }
  };

  const copyBriefing = async () => {
    setCopyingWhich("ai");
    setCopyError(null);
    try {
      const md = await runPromise(Effect.flatMap(DeviceService, (device) => device.aiContext(24 * 30)));
      await navigator.clipboard.writeText(md);
      flashCopy("ai");
    } catch (e) {
      setCopyError(String(e instanceof Error ? e.message : e));
    } finally {
      setCopyingWhich(null);
    }
  };

  const exportLabel = (id: string, idle: string) =>
    copyLabel === id ? t.common.copied : copyingWhich === id ? t.common.copying : idle;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">{t.vehicle.title}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Car className="h-4 w-4" aria-hidden="true" /> {t.vehicle.identity.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {infoLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : infoQuery.isError ? (
            <div className="flex items-center gap-2 text-destructive">
              <span>{t.vehicle.identity.couldNotLoad}</span>
              <Button variant="outline" onClick={() => infoQuery.refetch()}>
                {t.common.retry}
              </Button>
            </div>
          ) : Object.keys(info).length === 0 ? (
            <p className="text-muted-foreground">{t.vehicle.identity.nothingReadYet}</p>
          ) : (
            Object.entries(info).map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="w-28 text-muted-foreground">{k}</span>
                <span className="font-mono">{v}</span>
              </div>
            ))
          )}
          <div className="flex flex-col gap-2">
            <div>
              <Button variant="outline" onClick={() => readEcu.mutate()} disabled={!connected || readEcu.isPending}>
                <RefreshCw className={"h-4 w-4" + (readEcu.isPending ? " animate-spin" : "")} aria-hidden="true" />
                {readEcu.isPending ? t.vehicle.identity.reading : t.vehicle.identity.readFromEcu}
              </Button>
            </div>
            {readEcu.isError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {String(readEcu.error instanceof Error ? readEcu.error.message : readEcu.error)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Database className="h-4 w-4" aria-hidden="true" /> {t.vehicle.data.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t.vehicle.data.storedLocally}</p>
          {dbPathQuery.isPending ? (
            <Skeleton className="h-6 w-full" />
          ) : (
            <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">
              {dbPathQuery.data ?? t.vehicle.data.couldNotReadDbPath}
            </code>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={copyBriefing} disabled={copyingWhich !== null}>
              <Bot className="h-4 w-4" aria-hidden="true" />
              {copyLabel === "ai" ? t.vehicle.data.copiedAiBriefing : exportLabel("ai", t.vehicle.data.copyAiBriefing)}
            </Button>
            <Button variant="outline" onClick={() => copyExport(24, "24h")} disabled={copyingWhich !== null}>
              <Copy className="h-4 w-4" aria-hidden="true" /> {exportLabel("24h", t.vehicle.data.copyRawJson24h)}
            </Button>
            <Button variant="outline" onClick={() => copyExport(24 * 30, "30d")} disabled={copyingWhich !== null}>
              <Copy className="h-4 w-4" aria-hidden="true" /> {exportLabel("30d", t.vehicle.data.copyRawJson30d)}
            </Button>
          </div>
          {copyError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {copyError}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t.vehicle.data.briefingExplainer}</p>
        </CardContent>
      </Card>
    </div>
  );
}
