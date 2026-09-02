import { Effect, Layer, Schema, type ParseResult } from "effect";
import { invoke } from "@/lib/tauri";
import {
  DeviceService,
  InvokeError,
  ConnStatus,
  AdapterCandidate,
  AdapterProfile,
  NearbyDevice,
  CarReport,
  VehicleInfo,
  VehicleListRow,
  EcuInfo,
  DtcResult,
  DtcScanRow,
  ObdClearOutcome,
  WriteLogRow,
  ClearOutcome,
  DiscoveredDid,
  DiscoveredModule,
  DiscoveryReport,
  DiscoveryRun,
  FingerprintExperimentReport,
  VehicleEvidenceMap,
  UdsHit,
  UdsModule,
  UdsProbe,
  SensorReading,
  HistoryPoint,
  ReadingKey,
  Ride,
} from "@scainner/core";

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
  startRide: () => decoded(Ride, "start_ride"),
  stopRide: (id) => decoded(Ride, "stop_ride", { id }),
  listRides: (vehicleId) => decoded(Schema.mutable(Schema.Array(Ride)), "list_rides", { vehicleId }),
  connect: () => call<void>("connect"),
  disconnect: () => call<void>("disconnect"),
  listAdapters: () => decoded(Schema.mutable(Schema.Array(AdapterCandidate)), "list_adapters"),
  discoverAdapters: (seconds) => decoded(Schema.mutable(Schema.Array(NearbyDevice)), "discover_adapters", { seconds }),
  pairAdapter: (addr, pin) => call<void>("pair_adapter", { addr, pin }),
  adapterProfile: () => decoded(AdapterProfile, "get_adapter_profile"),
  setAdapterProfile: (profile) => decoded(AdapterProfile, "set_adapter_profile", { profile }),

  listVehicles: () => decoded(Schema.mutable(Schema.Array(VehicleListRow)), "list_vehicles"),
  vehicleReport: (vehicleId) => decoded(CarReport, "vehicle_report", { vehicleId }),
  vehicleInfo: (vehicleId) => decoded(Schema.NullOr(VehicleInfo), "vehicle_info", { vehicleId }),
  setVehicleName: (vehicleId, name) => call<void>("set_vehicle_name", { vehicleId, name }),
  nameCurrentVehicle: (name) => call<number>("name_current_vehicle", { name }),
  readEcuInfo: () => decoded(EcuInfo, "read_ecu_info"),
  dbPath: () => call<string>("db_path"),
  setFuelPrice: (vehicleId, price) => call<void>("set_fuel_price", { vehicleId, price }),

  dtcHistory: (vehicleId, limit) => decoded(Schema.mutable(Schema.Array(DtcScanRow)), "dtc_history", { vehicleId, limit }),
  scanDtcs: () => decoded(DtcResult, "scan_dtcs"),
  readiness: () => call<Record<string, boolean>>("readiness"),
  clearDtcs: () => decoded(ObdClearOutcome, "clear_dtcs", { confirmed: true }),

  allSensors: () => decoded(Schema.mutable(Schema.Array(SensorReading)), "all_sensors"),
  readingKeys: (vehicleId) => call<string[]>("reading_keys", { vehicleId }),
  readingKeyDetails: (vehicleId) => decoded(Schema.mutable(Schema.Array(ReadingKey)), "reading_key_details", { vehicleId }),
  historyPoints: (vehicleId, key, hours) => decoded(Schema.mutable(Schema.Array(HistoryPoint)), "history", { vehicleId, key, sinceHours: hours }),

  udsModules: () => decoded(Schema.mutable(Schema.Array(UdsModule)), "uds_modules"),
  addUdsModule: (fields) => call<void>("add_uds_module", fields),
  deleteUdsModule: (key) => call<void>("delete_uds_module", { key }),
  udsRead: (module, did) => decoded(Schema.NullOr(UdsHit), "uds_read", { module, did }),
  udsScan: (module, from, to) => decoded(Schema.mutable(Schema.Array(UdsHit)), "uds_scan", { module, from, to }),
  udsCancelScan: () => call<void>("uds_cancel_scan"),
  discoverSensors: (full) => decoded(DiscoveryReport, "discover_sensors", { full }),
  runDiscovery: (vehicleId) => decoded(DiscoveryRun, "run_discovery", { vehicleId }),
  discoveredModules: (vehicleId) => decoded(Schema.mutable(Schema.Array(DiscoveredModule)), "discovered_modules", { vehicleId }),
  discoveredDids: (moduleId) => decoded(Schema.mutable(Schema.Array(DiscoveredDid)), "discovered_dids", { moduleId }),
  fingerprintExperiment: () => decoded(FingerprintExperimentReport, "fingerprint_experiment"),
  vehicleEvidenceMap: (vehicleId) => decoded(VehicleEvidenceMap, "vehicle_evidence_map", { vehicleId }),
  udsClear: (module) => decoded(ClearOutcome, "uds_clear", { module, confirmed: true }),
  udsModuleDtcs: (module) => call<string[]>("uds_module_dtcs", { module }),
  listProbes: (vehicleId) => decoded(Schema.mutable(Schema.Array(UdsProbe)), "list_probes", { vehicleId }),
  addProbe: (probe, vehicleId) => call<void>("add_probe", { probe, vehicleId }),
  toggleProbe: (id, enabled) => call<void>("toggle_probe", { id, enabled }),
  deleteProbe: (id) => call<void>("delete_probe", { id }),

  exportJson: (vehicleId, sinceHours) => call<string>("export_json", { vehicleId, sinceHours }),
  aiContext: (vehicleId, sinceHours) => call<string>("ai_context", { vehicleId, sinceHours }),

  writesLog: (vehicleId, limit) => decoded(Schema.mutable(Schema.Array(WriteLogRow)), "writes_log", { vehicleId, limit }),
});
