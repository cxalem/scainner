
import type { ConnStatus, DiscoveryStatus } from "@scainner/core";

export type DiscoveryRunId = string;

export function discoveryRunId(discovery: DiscoveryStatus | null | undefined): DiscoveryRunId | null {
  if (!discovery || discovery.state !== "running") return null;
  return discovery.started_at ?? "running";
}

export function discoveryRunning(conn: Pick<ConnStatus, "discovery">): boolean {
  return conn.discovery?.state === "running";
}

export function showDiscoveryBanner(
  discovery: DiscoveryStatus | null | undefined,
  dismissedRunId: DiscoveryRunId | null,
): boolean {
  const id = discoveryRunId(discovery);
  return id !== null && id !== dismissedRunId;
}

export function showLiveDiscoveryNotice(
  discovery: DiscoveryStatus | null | undefined,
  mode: "now" | "trend",
): boolean {
  return mode === "now" && discovery?.state === "running";
}

export const DISCOVERY_STAGES = ["census", "identity", "join", "coverage"] as const;

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
