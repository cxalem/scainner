import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { invoke } from "@/lib/tauri";

export const DiagnosticCaseStatus = Schema.Literal("open", "in_progress", "waiting", "completed", "cancelled");
export type DiagnosticCaseStatus = typeof DiagnosticCaseStatus.Type;

export class DiagnosticCase extends Schema.Class<DiagnosticCase>("DiagnosticCase")({
  id: Schema.Number,
  cloud_id: Schema.String,
  vehicle_id: Schema.Number,
  reference: Schema.String,
  status: DiagnosticCaseStatus,
  complaint: Schema.String,
  odometer_km: Schema.NullOr(Schema.Number),
  assigned_to: Schema.NullOr(Schema.String),
  opened_at: Schema.String,
  updated_at: Schema.String,
  closed_at: Schema.NullOr(Schema.String),
}) {}

const CaseList = Schema.mutable(Schema.Array(DiagnosticCase));

async function decode<A, I>(schema: Schema.Schema<A, I>, value: unknown): Promise<A> {
  return Schema.decodeUnknownPromise(schema)(value);
}

export function useDiagnosticCases(vehicleId?: number | null) {
  return useQuery({
    queryKey: ["diagnostic_cases", vehicleId ?? "all"],
    queryFn: async () => decode(CaseList, await invoke<unknown>("diagnostic_cases", { vehicleId: vehicleId ?? null })),
  });
}

export function useCreateDiagnosticCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      vehicleId: number;
      complaint: string;
      odometerKm: number | null;
      assignedTo: string | null;
    }) => decode(DiagnosticCase, await invoke<unknown>("create_diagnostic_case", input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["diagnostic_cases"] }),
  });
}
