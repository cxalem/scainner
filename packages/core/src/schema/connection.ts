// Connection state: genuinely cross-feature (App.tsx, Shell.tsx,
// ConnectGate.tsx, every view's `connected` prop derives from it), so it
// lives in shared/domain rather than any one feature (research.md section
// 3: cross-feature types need a clear home or the feature boundary leaks).
import { Schema } from "effect";

// The connect pipeline's stages, in the order they run. The backend
// (elm/connect.rs) reports the one it is on while connecting, and names the
// one it stopped at when an attempt fails — there is no retry ladder behind
// this, so the stage is always the whole story.
export const ConnectStage = Schema.Literal("link", "open", "handshake", "bus");
export type ConnectStage = typeof ConnectStage.Type;

// Why the last attempt stopped, and where.
export const ConnectFailure = Schema.Struct({
  stage: ConnectStage,
  reason: Schema.String,
});
export type ConnectFailure = typeof ConnectFailure.Type;

// What the automatic sensor run (the backend's S1-S3 pass) is doing on
// this connection. It rides the same conn-status broadcast as `scanning`
// because it answers the same question from the user's side: live data is
// paused, and this is why (owner, 2026-09-01).
export const DiscoveryRunState = Schema.Literal("idle", "running", "skipped", "done");
export type DiscoveryRunState = typeof DiscoveryRunState.Type;

// Why the run happened or did not. A token, not a sentence: the copy is
// the app's, in the user's language (i18n dictionary t.discovery.reason).
export const DiscoveryReason = Schema.Literal(
  "never_run",
  "knowledge_changed",
  "requested",
  "knowledge_unchanged",
);
export type DiscoveryReason = typeof DiscoveryReason.Type;

// The four stages the protocol names, in the order they run.
export const DiscoveryStage = Schema.Literal("census", "identity", "join", "coverage");
export type DiscoveryStage = typeof DiscoveryStage.Type;

export const DiscoveryStatus = Schema.Struct({
  state: DiscoveryRunState,
  reason: Schema.optional(Schema.NullOr(DiscoveryReason)),
  stage: Schema.optional(Schema.NullOr(DiscoveryStage)),
  stage_done: Schema.optional(Schema.NullOr(Schema.Number)),
  stage_total: Schema.optional(Schema.NullOr(Schema.Number)),
  // When THIS run started; when the last completed run finished.
  started_at: Schema.optional(Schema.NullOr(Schema.String)),
  last_run_at: Schema.optional(Schema.NullOr(Schema.String)),
  // The maps this build ships. Same key twice = the same run would find
  // the same things, which is exactly why it is skipped.
  knowledge_key: Schema.String,
});
export type DiscoveryStatus = typeof DiscoveryStatus.Type;

export class ConnStatus extends Schema.Class<ConnStatus>("ConnStatus")({
  state: Schema.String,
  // Set while `state` is "connecting": which stage is running right now.
  stage: Schema.optional(Schema.NullOr(ConnectStage)),
  // Set with "disconnected" after a failed attempt, cleared by the next one.
  // One failed stage, one reason — the user decides whether to try again.
  error: Schema.optional(Schema.NullOr(ConnectFailure)),
  elm_version: Schema.optional(Schema.NullOr(Schema.String)),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  // The CURRENT connection's own resolved identity — never a cache of a
  // previous car (the bug caught live 2026-08-21 on a real ~2000 Peugeot).
  // vin/vehicle_id are null when this connection's vehicle couldn't be
  // identified: the frontend renders an honest unknown-vehicle state with a
  // "name this car" action. vehicle_is_new is true when THIS connect created
  // the vehicles row — it replaces the old knownVins-snapshot comparison for
  // triggering the first-connect discovery flow.
  vin: Schema.optional(Schema.NullOr(Schema.String)),
  vehicle_id: Schema.optional(Schema.NullOr(Schema.Number)),
  display_name: Schema.optional(Schema.NullOr(Schema.String)),
  vehicle_is_new: Schema.optional(Schema.Boolean),
  // A UDS scan (auto-discovery or the manual range scanner) is running —
  // standard PID polling is paused for its duration, so live gauges go
  // stale everywhere until it ends. Carried on the same broadcast every
  // view already listens to, so any tab can show an honest "scanning"
  // state instead of a silently frozen one (owner, 2026-08-24).
  scanning: Schema.optional(Schema.Boolean),
  // Absent until the connect phase has decided (and on a disconnected
  // status): "we don't know yet", not "idle".
  discovery: Schema.optional(Schema.NullOr(DiscoveryStatus)),
}) {}

// Live-event payload (from `listen("live-update", ...)`, not `invoke`) —
// stays a plain type, not Schema.Class. It's a listen()-event payload, not
// an invoke response (research.md section 8 scopes the event-listener
// surface out of this migration).
export type Live = Record<string, number>;

// No backend progress event for connect — this is a timed phrase list on
// the frontend, a deliberate scope cut (decisions-plan.md: "Keep the
// no-Rust non-goal"). English default kept here for any consumer without
// i18n (e.g. a future mobile client); the desktop app's own locale-aware
// copy lives in its i18n dictionary (t.shell.connectPhrases) and no longer
// reads this constant directly.
export const CONNECT_PHRASES = ["Waking the dongle…", "Negotiating protocol…"] as const;
