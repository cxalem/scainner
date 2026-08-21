// Connection state: genuinely cross-feature (App.tsx, Shell.tsx,
// ConnectGate.tsx, every view's `connected` prop derives from it), so it
// lives in shared/domain rather than any one feature (research.md section
// 3: cross-feature types need a clear home or the feature boundary leaks).
import { Schema } from "effect";

export class ConnStatus extends Schema.Class<ConnStatus>("ConnStatus")({
  state: Schema.String,
  elm_version: Schema.optional(Schema.NullOr(Schema.String)),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  // The CURRENT connection's own VIN, or null if it couldn't be read this
  // time — e.g. genuinely not implemented on an older, pre-Mode-09 ECU, not
  // just a transient failure. Deliberately separate from car_info's cached
  // vin (only updated on success, so it can hold a *previous* car's VIN) —
  // this field is what the frontend must key "what's connected right now"
  // off of, never the cache. Caught live 2026-08-21 on a real ~2000 Peugeot.
  vin: Schema.optional(Schema.NullOr(Schema.String)),
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
