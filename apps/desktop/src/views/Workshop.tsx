// Workshop: the cases you have open, with the complaint that started each
// one. Presentation only — the data is useDiagnosticCases /
// useCreateDiagnosticCase, unchanged.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FolderCheck, FolderOpen, Plus } from "lucide-react";
import {
  Banner,
  Button,
  Card,
  CardSkeleton,
  EmptyState,
  Field,
  Input,
  Mono,
  Pill,
  Seg,
  Select,
} from "@/components/ui";
import { Block, Item, List, Reveal } from "@/motion/components";
import { useVehicles } from "@/features/vehicle/queries";
import { useCreateDiagnosticCase, useDiagnosticCases, type DiagnosticCaseStatus } from "@/features/workshop/cases";
import { useT } from "@/i18n";

type Filter = "open" | "closed";
const CLOSED: DiagnosticCaseStatus[] = ["completed", "cancelled"];

export function Workshop({ connectedVehicleId }: { connectedVehicleId: number | null }) {
  const t = useT();
  const vehicles = useVehicles();
  const cases = useDiagnosticCases();
  const createCase = useCreateDiagnosticCase();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const [vehicleId, setVehicleId] = useState<number | null>(connectedVehicleId);
  const [complaint, setComplaint] = useState("");
  const [odometer, setOdometer] = useState("");
  const [technician, setTechnician] = useState("");

  useEffect(() => {
    if (connectedVehicleId != null) setVehicleId(connectedVehicleId);
  }, [connectedVehicleId]);

  const vehicleNames = useMemo(
    () =>
      new Map(
        (vehicles.data ?? []).map((v) => [v.id, v.display_name || v.vin || t.workshop.unknownVehicle(v.id)]),
      ),
    [t, vehicles.data],
  );
  const nameOf = (id: number | null) => (id == null ? null : (vehicleNames.get(id) ?? t.workshop.unknownVehicle(id)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null || !complaint.trim()) return;
    await createCase.mutateAsync({
      vehicleId,
      complaint: complaint.trim(),
      odometerKm: odometer ? Number(odometer) : null,
      assignedTo: technician.trim() || null,
    });
    setComplaint("");
    setOdometer("");
    setTechnician("");
    setShowForm(false);
  };

  const visible = (cases.data ?? []).filter((c) =>
    filter === "closed" ? CLOSED.includes(c.status) : !CLOSED.includes(c.status),
  );

  return (
    <>
      <Block className="flex items-center gap-2.5">
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setShowForm((v) => !v)}>
          {showForm ? t.workshop.closeForm : t.workshop.newCase}
        </Button>
        <Seg<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: t.workshop.filterOpen },
            { value: "closed", label: t.workshop.filterClosed },
          ]}
        />
      </Block>

      <Reveal when={showForm}>
        <Card className="gap-3">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <span className="text-[13.5px]">
              {t.workshop.newCaseFor(nameOf(vehicleId) ?? t.workshop.selectVehicle)}
            </span>
            {connectedVehicleId == null && (
              <Field label={t.workshop.vehicle} htmlFor="c-vehicle">
                <Select
                  id="c-vehicle"
                  value={vehicleId ?? ""}
                  onChange={(e) => setVehicleId(Number(e.target.value) || null)}
                  required
                >
                  <option value="">{t.workshop.selectVehicle}</option>
                  {(vehicles.data ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {vehicleNames.get(v.id)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t.workshop.complaintPrompt} htmlFor="c-complaint">
              <Input
                id="c-complaint"
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
                placeholder={t.workshop.complaintPlaceholderV2}
                required
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.workshop.odometer} htmlFor="c-odo">
                <Input
                  id="c-odo"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  className="num"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  placeholder={t.workshop.optional}
                />
              </Field>
              <Field label={t.workshop.technician} htmlFor="c-tech">
                <Input
                  id="c-tech"
                  value={technician}
                  onChange={(e) => setTechnician(e.target.value)}
                  placeholder={t.workshop.optional}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                {t.common.cancel}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                busy={createCase.isPending}
                disabled={vehicleId == null || !complaint.trim()}
              >
                {createCase.isPending ? t.workshop.creating : t.workshop.openTheCase}
              </Button>
            </div>
            <Reveal when={createCase.isError} mode="fade">
              <Banner tone="stop" className="rounded-md">
                {t.workshop.createError} {String(createCase.error)}
              </Banner>
            </Reveal>
          </form>
        </Card>
      </Reveal>

      <Block>
        {cases.isPending ? (
          <CardSkeleton rows={4} title={false} />
        ) : cases.isError ? (
          <Banner tone="stop" className="rounded-md">
            {t.workshop.loadError}
          </Banner>
        ) : cases.data.length === 0 ? (
          <Card flush>
            <EmptyState icon={FolderOpen} title={t.workshop.emptyTitle} body={t.workshop.emptyBody} />
          </Card>
        ) : visible.length === 0 ? (
          <Card flush>
            <EmptyState icon={FolderCheck} tone="muted" title={t.workshop.noCasesInFilter} />
          </Card>
        ) : (
          <List className="flex flex-col gap-[9px]">
            {visible.map((item) => {
              const closed = CLOSED.includes(item.status);
              const Icon = closed ? FolderCheck : FolderOpen;
              const meta = [
                nameOf(item.vehicle_id),
                item.odometer_km != null ? `${item.odometer_km.toLocaleString()} km` : null,
                item.assigned_to,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <Item key={item.id}>
                  <Card className="flex-row items-start gap-3.5 border border-transparent px-4 py-3.5 transition-colors duration-200 hover:border-accent-600">
                    <Icon
                      className={closed ? "mt-0.5 h-[17px] w-[17px] shrink-0 text-ok" : "mt-0.5 h-[17px] w-[17px] shrink-0 text-accent-400"}
                      aria-hidden="true"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-[13.5px]">{item.complaint}</span>
                      <span className="text-[11.5px] text-neutral-500">{meta}</span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-[5px]">
                      <Pill variant={closed ? "ok" : "accent"}>{closed ? t.workshop.status.closed : t.workshop.status.open}</Pill>
                      <Mono className="text-[11px] text-neutral-500">{item.opened_at}</Mono>
                    </div>
                  </Card>
                </Item>
              );
            })}
          </List>
        )}
      </Block>
    </>
  );
}
