// The `DeviceService` contract: every operation the app needs from whatever
// is actually talking to the car, behind one Context.Tag. Views/hooks never
// call a transport function directly — they ask for `DeviceService` and call
// a method.
//
// Deliberately Tag-only here, no Live layer. The concrete implementation is
// transport-specific (desktop: Tauri `invoke`; mobile, eventually: a BLE/
// classic-SPP bridge per docs/workflows/monorepo/plan.md's MX+ transport
// section) and belongs with the app that owns that transport, not in this
// shared package. Swapping the Live layer changes one file in the
// consuming app, not this contract or any call site.
import { Context, Effect, type ParseResult } from "effect";
import type { InvokeError } from "../errors";
import type { ConnStatus } from "../schema/connection";
import type { CarReport, EcuInfo, VehicleInfo, VehicleListRow } from "../schema/vehicle";
import type { DtcResult, DtcScanRow, ObdClearOutcome, WriteLogRow } from "../schema/diagnose";
import type { ClearOutcome, DiscoveredDid, DiscoveredModule, DiscoveryReport, FingerprintExperimentReport, UdsHit, UdsModule, UdsProbe, VehicleEvidenceMap } from "../schema/lab";
import type { SensorReading } from "../schema/live";
import type { HistoryPoint } from "../schema/history";

export class DeviceService extends Context.Tag("DeviceService")<
  DeviceService,
  {
    // connection
    readonly connStatus: () => Effect.Effect<ConnStatus, InvokeError | ParseResult.ParseError>;
    readonly connect: () => Effect.Effect<void, InvokeError>;
    readonly disconnect: () => Effect.Effect<void, InvokeError>;
    // vehicle / report (schema v2: keyed by vehicle id, never by VIN string)
    readonly listVehicles: () => Effect.Effect<VehicleListRow[], InvokeError | ParseResult.ParseError>;
    readonly vehicleReport: (vehicleId: number) => Effect.Effect<CarReport, InvokeError | ParseResult.ParseError>;
    readonly vehicleInfo: (vehicleId: number) => Effect.Effect<VehicleInfo | null, InvokeError | ParseResult.ParseError>;
    readonly setVehicleName: (vehicleId: number, name: string) => Effect.Effect<void, InvokeError>;
    /// The "name this car" flow for a live VIN-less connection; resolves to
    /// the new vehicle id (the supervisor re-emits conn-status itself).
    readonly nameCurrentVehicle: (name: string) => Effect.Effect<number, InvokeError>;
    readonly readEcuInfo: () => Effect.Effect<EcuInfo, InvokeError | ParseResult.ParseError>;
    readonly dbPath: () => Effect.Effect<string, InvokeError>;
    readonly setFuelPrice: (vehicleId: number, price: number) => Effect.Effect<void, InvokeError>;
    // dtc — vehicleId null means "the current unidentified connection's
    // scans," never "everything in the database."
    readonly dtcHistory: (vehicleId: number | null, limit: number) => Effect.Effect<DtcScanRow[], InvokeError | ParseResult.ParseError>;
    readonly scanDtcs: () => Effect.Effect<DtcResult, InvokeError | ParseResult.ParseError>;
    readonly readiness: () => Effect.Effect<Record<string, boolean>, InvokeError>;
    readonly clearDtcs: () => Effect.Effect<ObdClearOutcome, InvokeError | ParseResult.ParseError>;
    // sensors / history
    readonly allSensors: () => Effect.Effect<SensorReading[], InvokeError | ParseResult.ParseError>;
    readonly readingKeys: (vehicleId: number | null) => Effect.Effect<string[], InvokeError>;
    readonly historyPoints: (vehicleId: number | null, key: string, hours: number) => Effect.Effect<HistoryPoint[], InvokeError | ParseResult.ParseError>;
    // uds
    readonly udsModules: () => Effect.Effect<UdsModule[], InvokeError | ParseResult.ParseError>;
    readonly addUdsModule: (fields: {
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
    /// One-button auto-discovery — addresses/bands come from the VIN + the
    /// shipped knowledge map, never from the user. `full`: false re-probes
    /// only a prior pass's findings on this car (fast); true forces the
    /// complete blind sweep. Cancel via udsCancelScan.
    readonly discoverSensors: (full: boolean) => Effect.Effect<DiscoveryReport, InvokeError | ParseResult.ParseError>;
    readonly discoveredModules: (vehicleId: number) => Effect.Effect<DiscoveredModule[], InvokeError | ParseResult.ParseError>;
    readonly discoveredDids: (moduleId: number) => Effect.Effect<DiscoveredDid[], InvokeError | ParseResult.ParseError>;
    readonly fingerprintExperiment: () => Effect.Effect<FingerprintExperimentReport, InvokeError | ParseResult.ParseError>;
    readonly vehicleEvidenceMap: (vehicleId: number) => Effect.Effect<VehicleEvidenceMap, InvokeError | ParseResult.ParseError>;
    readonly udsClear: (module: string) => Effect.Effect<ClearOutcome, InvokeError | ParseResult.ParseError>;
    readonly udsModuleDtcs: (module: string) => Effect.Effect<string[], InvokeError>;
    // Probes are per-vehicle (2026-08-24): a probe found on one car must
    // never be attempted on another. vehicleId null = no identified
    // vehicle connected — returns only legacy (pre-scoping) global probes.
    readonly listProbes: (vehicleId: number | null) => Effect.Effect<UdsProbe[], InvokeError | ParseResult.ParseError>;
    readonly addProbe: (probe: UdsProbe, vehicleId: number | null) => Effect.Effect<void, InvokeError>;
    readonly toggleProbe: (id: number, enabled: boolean) => Effect.Effect<void, InvokeError>;
    readonly deleteProbe: (id: number) => Effect.Effect<void, InvokeError>;
    // one-shot exports / AI briefing
    readonly exportJson: (vehicleId: number | null, sinceHours: number) => Effect.Effect<string, InvokeError>;
    readonly aiContext: (vehicleId: number | null, sinceHours: number) => Effect.Effect<string, InvokeError>;
    // write audit trail
    readonly writesLog: (vehicleId: number | null, limit: number) => Effect.Effect<WriteLogRow[], InvokeError | ParseResult.ParseError>;
  }
>() {}
