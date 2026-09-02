// When to tell the user that the automatic sensor run is why live data is
// missing, and when to stop telling them.
//
// The rules are here rather than inline in Overview/Live because they are
// the same rules in both places and neither view is testable: Overview's
// banner and Live's notice must appear for the same run and disappear for
// the same reasons (owner, 2026-09-01 — "nothing says so").

import type { ConnStatus, DiscoveryStatus } from "@scainner/core";

/** Every run a dismissal can apply to needs a stable id for the session. */
export type DiscoveryRunId = string;

/**
 * The run's identity for dismissal purposes: its start time, which the
 * backend stamps once per run. A new run gets a new one, so a banner
 * dismissed during the last run comes back for the next — the deliberate
 * behaviour, since the second run blocks live data all over again.
 */
export function discoveryRunId(discovery: DiscoveryStatus | null | undefined): DiscoveryRunId | null {
  if (!discovery || discovery.state !== "running") return null;
  return discovery.started_at ?? "running";
}

/** A run is under way, so standard polling is paused. */
export function discoveryRunning(conn: Pick<ConnStatus, "discovery">): boolean {
  return conn.discovery?.state === "running";
}

/**
 * The Overview banner: shown while a run is under way, unless the user
 * dismissed *this* run. `dismissedRunId` is session state — a dismissal is
 * never remembered past the run it was about.
 */
export function showDiscoveryBanner(
  discovery: DiscoveryStatus | null | undefined,
  dismissedRunId: DiscoveryRunId | null,
): boolean {
  const id = discoveryRunId(discovery);
  return id !== null && id !== dismissedRunId;
}

/**
 * Live's notice replaces the gauges only while the run is actually
 * blocking them. `skipped` and `done` change nothing — the gauges are
 * live, or empty for the ordinary reason (not connected).
 */
export function showLiveDiscoveryNotice(
  discovery: DiscoveryStatus | null | undefined,
  mode: "now" | "trend",
): boolean {
  return mode === "now" && discovery?.state === "running";
}

/** Stage x of 4, for a progress bar that never lies about the total. */
export const DISCOVERY_STAGES = ["census", "identity", "join", "coverage"] as const;

/**
 * How far along the whole run is, 0–100. Each stage owns a quarter of the
 * bar and its own counter fills that quarter, so the bar never jumps back
 * when a stage with more candidates than the last one starts.
 */
export function discoveryPercent(discovery: DiscoveryStatus | null | undefined): number {
  if (!discovery || discovery.state !== "running") return 0;
  const index = DISCOVERY_STAGES.indexOf(
    (discovery.stage ?? "census") as (typeof DISCOVERY_STAGES)[number],
  );
  if (index < 0) return 0;
  const total = discovery.stage_total ?? 0;
  const done = discovery.stage_done ?? 0;
  const within = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return Math.round(((index + within) / DISCOVERY_STAGES.length) * 100);
}
