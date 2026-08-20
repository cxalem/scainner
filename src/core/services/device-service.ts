// Every Tauri `invoke()` call the frontend makes, behind one Context.Tag.
// Views/hooks never call `invoke()` directly once migrated — they ask for
// `DeviceService` and call a method. Swapping `DeviceServiceLive` (Tauri)
// for a future transport (mobile BLE bridge, Supabase) changes this one
// file, not every call site (research.md section 5).
//
// Grown command by command as the migration reaches each one
// (docs/workflows/effect-architecture/plan.md) — this is Phase 1's proof
// slice (car_report/report_cars/db_path, research's phase-1-safe picks),
// not the full ~29-command surface yet.
import { Context, Effect, Layer, Schema, type ParseResult } from "effect";
import { invoke } from "@/lib/tauri";
import { InvokeError } from "@/core/errors";
import { CarReport } from "@/lib/meta";

// Collapses the try/promise/catch boilerplate every hand-written call site
// used to repeat (research.md section 2). `decoded` adds a Schema parse on
// top for commands with a structured response.
function call<T>(command: string, args?: Record<string, unknown>): Effect.Effect<T, InvokeError> {
  return Effect.tryPromise({
    try: () => invoke<T>(command, args),
    catch: (cause) => new InvokeError({ command, cause }),
  });
}

function decoded<A, I>(
  schema: Schema.Schema<A, I>,
  command: string,
  args?: Record<string, unknown>,
): Effect.Effect<A, InvokeError | ParseResult.ParseError> {
  return call<unknown>(command, args).pipe(Effect.flatMap(Schema.decodeUnknown(schema)));
}

export class DeviceService extends Context.Tag("DeviceService")<
  DeviceService,
  {
    readonly reportCars: () => Effect.Effect<[string, number][], InvokeError>;
    readonly carReport: (vin: string) => Effect.Effect<CarReport, InvokeError | ParseResult.ParseError>;
    readonly dbPath: () => Effect.Effect<string, InvokeError>;
  }
>() {}

export const DeviceServiceLive = Layer.succeed(DeviceService, {
  reportCars: () => call<[string, number][]>("report_cars"),
  carReport: (vin) => decoded(CarReport, "car_report", { vin }),
  dbPath: () => call<string>("db_path"),
});
