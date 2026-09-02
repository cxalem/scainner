import { Context, Effect, type ParseResult } from "effect";
import type { InvokeError } from "../errors";
import type { ConnStatus } from "../schema/connection";
import type { AdapterCandidate, AdapterProfile, NearbyDevice } from "../schema/adapter";
import type { CarReport, EcuInfo, VehicleInfo, VehicleListRow } from "../schema/vehicle";
import type { DtcResult, DtcScanRow, ObdClearOutcome, WriteLogRow } from "../schema/diagnose";
import type { ClearOutcome, DiscoveredDid, DiscoveredModule, DiscoveryReport, DiscoveryRun, FingerprintExperimentReport, UdsHit, UdsModule, UdsProbe, VehicleEvidenceMap } from "../schema/lab";
import type { SensorReading } from "../schema/live";
import type { HistoryPoint, ReadingKey } from "../schema/history";

export class DeviceService extends Context.Tag("DeviceService")<
  DeviceService,
  {
    readonly connStatus: () => Effect.Effect<ConnStatus, InvokeError | ParseResult.ParseError>;
    readonly connect: () => Effect.Effect<void, InvokeError>;
    readonly disconnect: () => Effect.Effect<void, InvokeError>;
    readonly listAdapters: () => Effect.Effect<AdapterCandidate[], InvokeError | ParseResult.ParseError>;
    readonly discoverAdapters: (seconds: number) => Effect.Effect<NearbyDevice[], InvokeError | ParseResult.ParseError>;
    readonly pairAdapter: (addr: string, pin: string | null) => Effect.Effect<void, InvokeError>;
    readonly adapterProfile: () => Effect.Effect<AdapterProfile, InvokeError | ParseResult.ParseError>;
    readonly setAdapterProfile: (profile: AdapterProfile) => Effect.Effect<AdapterProfile, InvokeError | ParseResult.ParseError>;
    readonly listVehicles: () => Effect.Effect<VehicleListRow[], InvokeError | ParseResult.ParseError>;
    readonly vehicleReport: (vehicleId: number) => Effect.Effect<CarReport, InvokeError | ParseResult.ParseError>;
    readonly vehicleInfo: (vehicleId: number) => Effect.Effect<VehicleInfo | null, InvokeError | ParseResult.ParseError>;
    readonly setVehicleName: (vehicleId: number, name: string) => Effect.Effect<void, InvokeError>;
    readonly nameCurrentVehicle: (name: string) => Effect.Effect<number, InvokeError>;
    readonly readEcuInfo: () => Effect.Effect<EcuInfo, InvokeError | ParseResult.ParseError>;
    readonly dbPath: () => Effect.Effect<string, InvokeError>;
    readonly setFuelPrice: (vehicleId: number, price: number) => Effect.Effect<void, InvokeError>;
    readonly dtcHistory: (vehicleId: number | null, limit: number) => Effect.Effect<DtcScanRow[], InvokeError | ParseResult.ParseError>;
    readonly scanDtcs: () => Effect.Effect<DtcResult, InvokeError | ParseResult.ParseError>;
    readonly readiness: () => Effect.Effect<Record<string, boolean>, InvokeError>;
    readonly clearDtcs: () => Effect.Effect<ObdClearOutcome, InvokeError | ParseResult.ParseError>;
    readonly allSensors: () => Effect.Effect<SensorReading[], InvokeError | ParseResult.ParseError>;
    readonly readingKeys: (vehicleId: number | null) => Effect.Effect<string[], InvokeError>;
    readonly readingKeyDetails: (
      vehicleId: number | null,
    ) => Effect.Effect<ReadingKey[], InvokeError | ParseResult.ParseError>;
    readonly historyPoints: (vehicleId: number | null, key: string, hours: number) => Effect.Effect<HistoryPoint[], InvokeError | ParseResult.ParseError>;
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
    readonly discoverSensors: (full: boolean) => Effect.Effect<DiscoveryReport, InvokeError | ParseResult.ParseError>;
    readonly runDiscovery: (vehicleId: number) => Effect.Effect<DiscoveryRun, InvokeError | ParseResult.ParseError>;
    readonly discoveredModules: (vehicleId: number) => Effect.Effect<DiscoveredModule[], InvokeError | ParseResult.ParseError>;
    readonly discoveredDids: (moduleId: number) => Effect.Effect<DiscoveredDid[], InvokeError | ParseResult.ParseError>;
    readonly fingerprintExperiment: () => Effect.Effect<FingerprintExperimentReport, InvokeError | ParseResult.ParseError>;
    readonly vehicleEvidenceMap: (vehicleId: number) => Effect.Effect<VehicleEvidenceMap, InvokeError | ParseResult.ParseError>;
    readonly udsClear: (module: string) => Effect.Effect<ClearOutcome, InvokeError | ParseResult.ParseError>;
    readonly udsModuleDtcs: (module: string) => Effect.Effect<string[], InvokeError>;
    readonly listProbes: (vehicleId: number | null) => Effect.Effect<UdsProbe[], InvokeError | ParseResult.ParseError>;
    readonly addProbe: (probe: UdsProbe, vehicleId: number | null) => Effect.Effect<void, InvokeError>;
    readonly toggleProbe: (id: number, enabled: boolean) => Effect.Effect<void, InvokeError>;
    readonly deleteProbe: (id: number) => Effect.Effect<void, InvokeError>;
    readonly exportJson: (vehicleId: number | null, sinceHours: number) => Effect.Effect<string, InvokeError>;
    readonly aiContext: (vehicleId: number | null, sinceHours: number) => Effect.Effect<string, InvokeError>;
    readonly writesLog: (vehicleId: number | null, limit: number) => Effect.Effect<WriteLogRow[], InvokeError | ParseResult.ParseError>;
  }
>() {}
