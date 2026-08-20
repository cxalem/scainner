// Every Tauri `invoke()` call the frontend makes, behind one Context.Tag.
// Views/hooks never call `invoke()` directly once migrated — they ask for
// `DeviceService` and call a method. Swapping `DeviceServiceLive` (Tauri)
// for a future transport (mobile BLE bridge, Supabase) changes this one
// file, not every call site (research.md section 5). `connect`/`disconnect`
// live here too even though they pair with `listen("conn-status", ...)` in
// App.tsx — the event subscription itself stays raw Tauri (research.md
// section 8), only the one-shot invoke goes through the service.
import { Context, Effect, Layer, Schema, type ParseResult } from "effect";
import { invoke } from "@/lib/tauri";
import { InvokeError } from "@/core/errors";
import { ConnStatus } from "@/shared/domain/connection";
import { CarReport, EcuInfo } from "@/features/vehicle/schema";
import { DtcResult, DtcScanRow, ObdClearOutcome, WriteLogRow } from "@/features/diagnose/schema";
import { ClearOutcome, UdsHit, UdsModule, UdsProbe } from "@/features/lab/schema";
import { SensorReading } from "@/features/live/schema";
import { HistoryPoint } from "@/features/history/schema";

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
    // connection
    readonly connStatus: () => Effect.Effect<ConnStatus, InvokeError | ParseResult.ParseError>;
    readonly connect: () => Effect.Effect<void, InvokeError>;
    readonly disconnect: () => Effect.Effect<void, InvokeError>;
    // vehicle / report
    readonly reportCars: () => Effect.Effect<[string, number][], InvokeError>;
    readonly carReport: (vin: string) => Effect.Effect<CarReport, InvokeError | ParseResult.ParseError>;
    readonly carInfo: () => Effect.Effect<[string, string][], InvokeError>;
    readonly readEcuInfo: () => Effect.Effect<EcuInfo, InvokeError | ParseResult.ParseError>;
    readonly dbPath: () => Effect.Effect<string, InvokeError>;
    readonly setFuelPrice: (price: number) => Effect.Effect<void, InvokeError>;
    // dtc
    readonly dtcHistory: (limit: number) => Effect.Effect<DtcScanRow[], InvokeError | ParseResult.ParseError>;
    readonly scanDtcs: () => Effect.Effect<DtcResult, InvokeError | ParseResult.ParseError>;
    readonly readiness: () => Effect.Effect<Record<string, boolean>, InvokeError>;
    readonly clearDtcs: () => Effect.Effect<ObdClearOutcome, InvokeError | ParseResult.ParseError>;
    // sensors / history
    readonly allSensors: () => Effect.Effect<SensorReading[], InvokeError | ParseResult.ParseError>;
    readonly readingKeys: () => Effect.Effect<string[], InvokeError>;
    readonly historyPoints: (key: string, hours: number) => Effect.Effect<HistoryPoint[], InvokeError | ParseResult.ParseError>;
    // uds
    readonly udsModules: () => Effect.Effect<UdsModule[], InvokeError | ParseResult.ParseError>;
    readonly addUdsModule: (v: {
      key: string;
      label: string;
      req: string;
      resp: string;
    }) => Effect.Effect<void, InvokeError>;
    readonly deleteUdsModule: (key: string) => Effect.Effect<void, InvokeError>;
    readonly udsRead: (module: string, did: number) => Effect.Effect<UdsHit | null, InvokeError | ParseResult.ParseError>;
    readonly udsScan: (
      module: string,
      from: number,
      to: number,
    ) => Effect.Effect<UdsHit[], InvokeError | ParseResult.ParseError>;
    readonly udsCancelScan: () => Effect.Effect<void, InvokeError>;
    readonly udsClear: (module: string) => Effect.Effect<ClearOutcome, InvokeError | ParseResult.ParseError>;
    readonly udsModuleDtcs: (module: string) => Effect.Effect<string[], InvokeError>;
    readonly listProbes: () => Effect.Effect<UdsProbe[], InvokeError | ParseResult.ParseError>;
    readonly addProbe: (probe: UdsProbe) => Effect.Effect<void, InvokeError>;
    readonly toggleProbe: (id: number, enabled: boolean) => Effect.Effect<void, InvokeError>;
    readonly deleteProbe: (id: number) => Effect.Effect<void, InvokeError>;
    // one-shot exports / AI briefing
    readonly exportJson: (sinceHours: number) => Effect.Effect<string, InvokeError>;
    readonly aiContext: (sinceHours: number) => Effect.Effect<string, InvokeError>;
    // write audit trail
    readonly writesLog: (limit: number) => Effect.Effect<WriteLogRow[], InvokeError | ParseResult.ParseError>;
  }
>() {}

export const DeviceServiceLive = Layer.succeed(DeviceService, {
  connStatus: () => decoded(ConnStatus, "conn_status"),
  connect: () => call<void>("connect"),
  disconnect: () => call<void>("disconnect"),

  reportCars: () => call<[string, number][]>("report_cars"),
  carReport: (vin) => decoded(CarReport, "car_report", { vin }),
  carInfo: () => call<[string, string][]>("car_info"),
  readEcuInfo: () => decoded(EcuInfo, "read_ecu_info"),
  dbPath: () => call<string>("db_path"),
  setFuelPrice: (price) => call<void>("set_fuel_price", { price }),

  dtcHistory: (limit) => decoded(Schema.mutable(Schema.Array(DtcScanRow)), "dtc_history", { limit }),
  scanDtcs: () => decoded(DtcResult, "scan_dtcs"),
  readiness: () => call<Record<string, boolean>>("readiness"),
  clearDtcs: () => decoded(ObdClearOutcome, "clear_dtcs", { confirmed: true }),

  allSensors: () => decoded(Schema.mutable(Schema.Array(SensorReading)), "all_sensors"),
  readingKeys: () => call<string[]>("reading_keys"),
  historyPoints: (key, hours) => decoded(Schema.mutable(Schema.Array(HistoryPoint)), "history", { key, sinceHours: hours }),

  udsModules: () => decoded(Schema.mutable(Schema.Array(UdsModule)), "uds_modules"),
  addUdsModule: (v) => call<void>("add_uds_module", v),
  deleteUdsModule: (key) => call<void>("delete_uds_module", { key }),
  udsRead: (module, did) => decoded(Schema.NullOr(UdsHit), "uds_read", { module, did }),
  udsScan: (module, from, to) => decoded(Schema.mutable(Schema.Array(UdsHit)), "uds_scan", { module, from, to }),
  udsCancelScan: () => call<void>("uds_cancel_scan"),
  udsClear: (module) => decoded(ClearOutcome, "uds_clear", { module, confirmed: true }),
  udsModuleDtcs: (module) => call<string[]>("uds_module_dtcs", { module }),
  listProbes: () => decoded(Schema.mutable(Schema.Array(UdsProbe)), "list_probes"),
  addProbe: (probe) => call<void>("add_probe", { probe }),
  toggleProbe: (id, enabled) => call<void>("toggle_probe", { id, enabled }),
  deleteProbe: (id) => call<void>("delete_probe", { id }),

  exportJson: (sinceHours) => call<string>("export_json", { sinceHours }),
  aiContext: (sinceHours) => call<string>("ai_context", { sinceHours }),

  writesLog: (limit) => decoded(Schema.mutable(Schema.Array(WriteLogRow)), "writes_log", { limit }),
});
