// The desktop (Tauri) implementation of `DeviceService` (packages/core).
// Split out from the shared contract on the monorepo move: the Tag lives in
// @scainner/core, the concrete Live layer — which talks to Tauri's `invoke`
// specifically — lives here, next to the app that owns that transport. A
// future mobile transport gets its own Live layer next to apps/mobile
// instead of a branch in this file.
import { Effect, Layer, Schema, type ParseResult } from "effect";
import { invoke } from "@/lib/tauri";
import {
  DeviceService,
  InvokeError,
  ConnStatus,
  CarReport,
  EcuInfo,
  DtcResult,
  DtcScanRow,
  ObdClearOutcome,
  WriteLogRow,
  ClearOutcome,
  UdsHit,
  UdsModule,
  UdsProbe,
  SensorReading,
  HistoryPoint,
} from "@scainner/core";

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
  addUdsModule: (fields) => call<void>("add_uds_module", fields),
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
