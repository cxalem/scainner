// Vehicle — identity, where every fact came from, and your data.
// Presentation over the same queries as before (vehicle_info, evidence
// map, db path, ECU re-read, exports); the only write is the connected
// car's display name (the one fact the backend lets the person set).
import { Suspense, lazy, useEffect, useState } from "react";
import { Effect } from "effect";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { Check, ClipboardList, Database, FileCode, MapPin, RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  CardHead,
  CardSkeleton,
  Field,
  Input,
  Mono,
  Note,
  Pill,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
  useTransientLabel,
  type PillVariant,
} from "@/components/ui";
import { Block, Reveal } from "@/motion/components";
import { useDbPath, useNameCurrentVehicle, useReadEcuInfo, useVehicleInfo } from "@/features/vehicle/queries";
import { brandFromVin } from "@/lib/brand";
import { AccountSyncCard } from "@/views/vehicle/AccountSyncCard";
import { VehicleEvidenceMap } from "@/views/vehicle/VehicleEvidenceMap";
import { useT } from "@/i18n";

const VehicleScene = lazy(() => import("@/components/VehicleScene").then((m) => ({ default: m.VehicleScene })));

type FactSource = "ecu" | "vin" | "you" | "documented" | "unknown";
const SOURCE_PILL: Record<FactSource, PillVariant> = {
  ecu: "ok",
  vin: "ok",
  you: "accent",
  documented: "info",
  unknown: "standard",
};

export function Vehicle({ connected, vehicleId = null }: { connected: boolean; vehicleId?: number | null }) {
  const t = useT();
  const infoQuery = useVehicleInfo(vehicleId);
  const vehicle = infoQuery.data ?? null;
  const infoLoading = vehicleId !== null && infoQuery.isPending;
  const dbPathQuery = useDbPath();
  const readEcu = useReadEcuInfo();
  const nameVehicle = useNameCurrentVehicle();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => setName(vehicle?.display_name ?? ""), [vehicle?.display_name]);
  const [nameLabel, flashName] = useTransientLabel(2000);

  const [copyingWhich, setCopyingWhich] = useState<string | null>(null);
  const [copyLabel, flashCopy] = useTransientLabel(2500);
  const [copyError, setCopyError] = useState<string | null>(null);

  const copyExport = async (hours: number, label: string) => {
    setCopyingWhich(label);
    setCopyError(null);
    try {
      const json = await runPromise(Effect.flatMap(DeviceService, (device) => device.exportJson(vehicleId, hours)));
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
      const md = await runPromise(Effect.flatMap(DeviceService, (device) => device.aiContext(vehicleId, 24 * 30)));
      await navigator.clipboard.writeText(md);
      flashCopy("ai");
    } catch (e) {
      setCopyError(String(e instanceof Error ? e.message : e));
    } finally {
      setCopyingWhich(null);
    }
  };

  const exports = [
    { id: "ai", label: t.vehicle.data.copyAiBriefing, icon: ClipboardList, go: copyBriefing },
    { id: "24h", label: t.vehicle.data.copyRawJson24h, icon: FileCode, go: () => copyExport(24, "24h") },
    { id: "30d", label: t.vehicle.data.copyRawJson30d, icon: FileCode, go: () => copyExport(24 * 30, "30d") },
  ];

  // Identity, from what the row actually holds.
  const brand = brandFromVin(vehicle?.vin);
  const make = vehicle?.make ?? brand?.name ?? null;
  const headline = [make, vehicle?.model].filter(Boolean).join(" ") || vehicle?.display_name || t.vehicle.identity.unnamed;
  const identityBits = [
    vehicle?.trim ?? null,
    vehicle?.display_name && headline !== vehicle.display_name ? vehicle.display_name : null,
    vehicle?.first_connected_at ? t.vehicle.identity.firstConnected(vehicle.first_connected_at.slice(0, 10)) : null,
  ].filter((x): x is string => !!x);

  const facts: { key: string; label: string; value: string | null; source: FactSource }[] = vehicle
    ? [
        { key: "vin", label: t.vehicle.facts.fact.vin, value: vehicle.vin, source: vehicle.vin ? "ecu" : "unknown" },
        { key: "make", label: t.vehicle.facts.fact.make, value: make, source: vehicle.make ? "ecu" : brand ? "vin" : "unknown" },
        { key: "model", label: t.vehicle.facts.fact.model, value: vehicle.model, source: vehicle.model ? "documented" : "unknown" },
        { key: "year", label: t.vehicle.facts.fact.year, value: vehicle.year != null ? String(vehicle.year) : null, source: vehicle.year != null ? "documented" : "unknown" },
        { key: "name", label: t.vehicle.facts.fact.name, value: vehicle.display_name, source: vehicle.display_name ? "you" : "unknown" },
      ]
    : [];

  const canName = connected && vehicleId != null;
  const saveName = () => {
    if (!canName || !name.trim()) return;
    nameVehicle.mutate({ name: name.trim() }, { onSuccess: () => flashName("saved") });
  };

  return (
    <>
      <Block>
        {infoLoading ? (
          <CardSkeleton rows={3} />
        ) : infoQuery.isError ? (
          <Card>
            <div className="flex items-center gap-3 text-[13px] text-stop">
              <span>{t.vehicle.identity.couldNotLoad}</span>
              <Button size="sm" onClick={() => infoQuery.refetch()}>
                {t.common.retry}
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="flex-row items-start gap-[18px] px-[18px] py-4">
            <div className="flex flex-1 flex-col gap-[9px]">
              <div className="flex items-baseline gap-2.5">
                <span className="font-heading text-[18px] font-medium">{headline}</span>
                <span className="text-[12.5px] text-neutral-500">
                  {vehicle?.year ?? (vehicle ? t.vehicle.identity.unknownYear : "")}
                </span>
              </div>
              <Mono className="text-[12.5px] text-neutral-500">{vehicle?.vin ?? t.vehicle.identity.nothingReadYet}</Mono>
              {identityBits.length > 0 && <span className="text-[13px] text-neutral-400">{identityBits.join(" · ")}</span>}
              <div className="mt-[3px] flex gap-2">
                <Button size="sm" icon={RefreshCw} busy={readEcu.isPending} disabled={!connected} onClick={() => readEcu.mutate()}>
                  {readEcu.isPending ? t.vehicle.identity.reading : t.vehicle.identity.readFromEcu}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDetailsOpen((o) => !o)} aria-expanded={detailsOpen}>
                  {detailsOpen ? t.vehicle.identity.done : t.vehicle.identity.editDetails}
                </Button>
              </div>
              {readEcu.isError && (
                <Note className="text-stop">{String(readEcu.error instanceof Error ? readEcu.error.message : readEcu.error)}</Note>
              )}
            </div>
            <div className="h-[132px] w-[200px] shrink-0 overflow-hidden rounded-md border border-divider">
              <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
                <VehicleScene
                  status={connected ? "connected" : "disconnected"}
                  vin={vehicle?.vin}
                  caption={null}
                  className="h-[132px] w-[200px]"
                  background="light"
                />
              </Suspense>
            </div>
          </Card>
        )}
      </Block>

      <Reveal when={detailsOpen}>
        <Card className="gap-[13px] px-[18px] py-4">
          <span className="text-[13.5px]">{t.vehicle.facts.formTitle}</span>
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveName();
            }}
          >
            <Field label={t.vehicle.facts.nameLabel} htmlFor="v-name" hint={canName ? t.vehicle.facts.nameHint : t.vehicle.facts.nameNeedsConnection}>
              <Input id="v-name" value={name} placeholder={t.vehicle.facts.namePlaceholder} onChange={(e) => setName(e.target.value)} disabled={!canName} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" size="md" variant="primary" busy={nameVehicle.isPending} disabled={!canName || !name.trim()}>
                {nameLabel === "saved" ? t.vehicle.facts.savedName : nameVehicle.isPending ? t.vehicle.facts.savingName : t.vehicle.facts.saveName}
              </Button>
            </div>
          </form>
          {nameVehicle.isError && (
            <Note className="text-stop">{String(nameVehicle.error instanceof Error ? nameVehicle.error.message : nameVehicle.error)}</Note>
          )}
        </Card>
      </Reveal>

      <Block>
        <Card flush>
          <CardHead divided icon={MapPin} title={t.vehicle.facts.tableTitle} aside={t.vehicle.facts.noGuess} />
          {facts.length === 0 ? (
            <Note className="px-[17px] py-3">{vehicleId == null ? t.vehicle.map.noVehicle : t.vehicle.identity.nothingReadYet}</Note>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.vehicle.facts.thFact}</Th>
                  <Th>{t.vehicle.facts.thValue}</Th>
                  <Th>{t.vehicle.facts.thSource}</Th>
                </tr>
              </thead>
              <tbody>
                {facts.map((f) => (
                  <Tr key={f.key}>
                    <Td className="text-neutral-500">{f.label}</Td>
                    <Td>{f.key === "vin" && f.value ? <Mono>{f.value}</Mono> : (f.value ?? <span className="text-neutral-500">{t.vehicle.facts.notKnown}</span>)}</Td>
                    <Td>
                      <Pill variant={SOURCE_PILL[f.source]}>{t.vehicle.facts.source[f.source]}</Pill>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </Block>

      <Block>
        <VehicleEvidenceMap vehicleId={vehicleId} />
      </Block>

      <Block>
        <div className="grid grid-cols-2 gap-3">
          <Card className="gap-[11px]">
            <CardHead icon={Database} title={t.vehicle.data.yourData} />
            {dbPathQuery.isPending ? (
              <Skeleton className="h-4 w-full" />
            ) : (
              <Mono className="break-all text-[11.5px] text-neutral-500">{dbPathQuery.data ?? t.vehicle.data.couldNotReadDbPath}</Mono>
            )}
            <div className="flex flex-wrap gap-[7px]">
              {exports.map((x) => {
                const done = copyLabel === x.id;
                return (
                  <Button
                    key={x.id}
                    size="sm"
                    icon={done ? Check : x.icon}
                    busy={copyingWhich === x.id}
                    disabled={copyingWhich !== null}
                    onClick={() => void x.go()}
                  >
                    {done ? t.common.copied : x.label}
                  </Button>
                );
              })}
            </div>
            {copyError && <Note className="text-stop">{copyError}</Note>}
            <Note className="text-[11.5px]">{t.vehicle.data.briefingExplainer}</Note>
          </Card>
          <AccountSyncCard />
        </div>
      </Block>
    </>
  );
}
