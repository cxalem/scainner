import { Schema } from "effect";
import { RideStatus } from "./ride";

export const ConnectStage = Schema.Literal("link", "open", "handshake", "bus");
export type ConnectStage = typeof ConnectStage.Type;

export const ConnectFailure = Schema.Struct({
  stage: ConnectStage,
  reason: Schema.String,
});
export type ConnectFailure = typeof ConnectFailure.Type;

export const DiscoveryRunState = Schema.Literal("idle", "running", "skipped", "done");
export type DiscoveryRunState = typeof DiscoveryRunState.Type;

export const DiscoveryReason = Schema.Literal(
  "never_run",
  "knowledge_changed",
  "requested",
  "knowledge_unchanged",
);
export type DiscoveryReason = typeof DiscoveryReason.Type;

export const DiscoveryStage = Schema.Literal("census", "identity", "join", "coverage");
export type DiscoveryStage = typeof DiscoveryStage.Type;

export const DiscoveryStatus = Schema.Struct({
  state: DiscoveryRunState,
  reason: Schema.optional(Schema.NullOr(DiscoveryReason)),
  stage: Schema.optional(Schema.NullOr(DiscoveryStage)),
  stage_done: Schema.optional(Schema.NullOr(Schema.Number)),
  stage_total: Schema.optional(Schema.NullOr(Schema.Number)),
  started_at: Schema.optional(Schema.NullOr(Schema.String)),
  last_run_at: Schema.optional(Schema.NullOr(Schema.String)),
  knowledge_key: Schema.String,
});
export type DiscoveryStatus = typeof DiscoveryStatus.Type;

export class ConnStatus extends Schema.Class<ConnStatus>("ConnStatus")({
  state: Schema.String,
  stage: Schema.optional(Schema.NullOr(ConnectStage)),
  error: Schema.optional(Schema.NullOr(ConnectFailure)),
  elm_version: Schema.optional(Schema.NullOr(Schema.String)),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  vin: Schema.optional(Schema.NullOr(Schema.String)),
  vehicle_id: Schema.optional(Schema.NullOr(Schema.Number)),
  display_name: Schema.optional(Schema.NullOr(Schema.String)),
  vehicle_is_new: Schema.optional(Schema.Boolean),
  scanning: Schema.optional(Schema.Boolean),
  discovery: Schema.optional(Schema.NullOr(DiscoveryStatus)),
  ride: Schema.optional(Schema.NullOr(RideStatus)),
}) {}

export type Live = Record<string, number>;

export const CONNECT_PHRASES = ["Waking the dongle…", "Negotiating protocol…"] as const;
