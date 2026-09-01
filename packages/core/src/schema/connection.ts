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
