import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, CardSkeleton } from "@/components/ui";
import { useVehicles } from "@/features/vehicle/queries";
import { useCreateDiagnosticCase, useDiagnosticCases } from "@/features/workshop/cases";
import { useT } from "@/i18n";

export function Workshop({ connectedVehicleId }: { connectedVehicleId: number | null }) {
  const t = useT();
  const vehicles = useVehicles();
  const cases = useDiagnosticCases();
  const createCase = useCreateDiagnosticCase();
  const [showForm, setShowForm] = useState(false);
  const [vehicleId, setVehicleId] = useState<number | null>(connectedVehicleId);
  const [complaint, setComplaint] = useState("");
  const [odometer, setOdometer] = useState("");
  const [technician, setTechnician] = useState("");

  useEffect(() => {
    if (connectedVehicleId != null) setVehicleId(connectedVehicleId);
  }, [connectedVehicleId]);

  const vehicleNames = useMemo(
    () => new Map((vehicles.data ?? []).map((vehicle) => [vehicle.id, vehicle.display_name || vehicle.vin || t.workshop.unknownVehicle(vehicle.id)])),
    [t, vehicles.data],
  );

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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t.workshop.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.workshop.subtitle}</p>
        </div>
        <Button onClick={() => setShowForm((value) => !value)}><Plus className="h-4 w-4" /> {t.workshop.newCase}</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>{t.workshop.intake}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t.workshop.vehicle}</span>
                <select className="h-9 rounded-md border border-border bg-background px-3" value={vehicleId ?? ""} onChange={(e) => setVehicleId(Number(e.target.value) || null)} required>
                  <option value="">{t.workshop.selectVehicle}</option>
                  {(vehicles.data ?? []).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.display_name || vehicle.vin || t.workshop.unknownVehicle(vehicle.id)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t.workshop.technician}</span>
                <input className="h-9 rounded-md border border-border bg-background px-3" value={technician} onChange={(e) => setTechnician(e.target.value)} placeholder={t.workshop.optional} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm md:col-span-2">
                <span className="font-medium">{t.workshop.complaint}</span>
                <textarea className="min-h-24 rounded-md border border-border bg-background px-3 py-2" value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder={t.workshop.complaintPlaceholder} required />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t.workshop.odometer}</span>
                <input className="h-9 rounded-md border border-border bg-background px-3" type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder={t.workshop.optional} />
              </label>
              <div className="flex items-end justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>{t.common.cancel}</Button>
                <Button type="submit" disabled={createCase.isPending || vehicleId == null || !complaint.trim()}>{createCase.isPending ? t.workshop.creating : t.workshop.createCase}</Button>
              </div>
              {createCase.isError && <p className="text-sm text-destructive md:col-span-2">{t.workshop.createError} {String(createCase.error)}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      {cases.isPending ? <CardSkeleton rows={4} /> : cases.isError ? (
        <Card><CardContent className="pt-4 text-sm text-destructive">{t.workshop.loadError}</CardContent></Card>
      ) : cases.data.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center"><ClipboardList className="h-6 w-6 text-muted-foreground" /><p className="font-medium">{t.workshop.emptyTitle}</p><p className="text-sm text-muted-foreground">{t.workshop.emptyBody}</p></CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {cases.data.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex items-start justify-between gap-5 pt-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3"><span className="font-mono text-xs text-muted-foreground">{item.reference}</span><Badge variant={item.status === "waiting" ? "warn" : "default"}>{item.status.replace("_", " ")}</Badge></div>
                  <p className="mt-2 font-medium">{item.complaint}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{vehicleNames.get(item.vehicle_id) ?? t.workshop.unknownVehicle(item.vehicle_id)}{item.odometer_km != null ? ` · ${item.odometer_km.toLocaleString()} km` : ""}{item.assigned_to ? ` · ${item.assigned_to}` : ""}</p>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">{item.opened_at}</time>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
