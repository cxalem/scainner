// Connection state: genuinely cross-feature (App.tsx, Shell.tsx,
// ConnectGate.tsx, every view's `connected` prop derives from it), so it
// lives in shared/domain rather than any one feature (research.md section
// 3: cross-feature types need a clear home or the feature boundary leaks).
import { Schema } from "effect";

export class ConnStatus extends Schema.Class<ConnStatus>("ConnStatus")({
  state: Schema.String,
  elm_version: Schema.optional(Schema.NullOr(Schema.String)),
  detail: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

// Live-event payload (from `listen("live-update", ...)`, not `invoke`) —
// stays a plain type, not Schema.Class. It's a listen()-event payload, not
// an invoke response (research.md section 8 scopes the event-listener
// surface out of this migration).
export type Live = Record<string, number>;

// No backend progress event for connect — this is a timed phrase list on
// the frontend, a deliberate scope cut (decisions-plan.md: "Keep the
// no-Rust non-goal").
export const CONNECT_PHRASES = ["Waking the dongle…", "Negotiating protocol…"] as const;
