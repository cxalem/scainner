import { describe, expect, it } from "vitest";
import type { DiscoveryStatus } from "@scainner/core";
import {
  discoveryPercent,
  discoveryRunId,
  discoveryRunning,
  showDiscoveryBanner,
  showLiveDiscoveryNotice,
} from "./discovery-notice";

const at = (over: Partial<DiscoveryStatus> = {}): DiscoveryStatus => ({
  state: "running",
  knowledge_key: "k1;map=9@2026-08-28;research=;packs=;plan=1",
  started_at: "2026-09-01 10:00:00",
  ...over,
});

describe("showDiscoveryBanner", () => {
  it("shows while a run is under way", () => {
    expect(showDiscoveryBanner(at(), null)).toBe(true);
  });

  it("stays hidden for the run the user dismissed", () => {
    expect(showDiscoveryBanner(at(), "2026-09-01 10:00:00")).toBe(false);
  });

  it("comes back for the next run, which blocks live data again", () => {
    expect(showDiscoveryBanner(at({ started_at: "2026-09-01 11:30:00" }), "2026-09-01 10:00:00")).toBe(true);
  });

  it("shows nothing when the run is skipped, done, idle or unknown", () => {
    expect(showDiscoveryBanner(at({ state: "skipped" }), null)).toBe(false);
    expect(showDiscoveryBanner(at({ state: "done" }), null)).toBe(false);
    expect(showDiscoveryBanner(at({ state: "idle" }), null)).toBe(false);
    expect(showDiscoveryBanner(null, null)).toBe(false);
    expect(showDiscoveryBanner(undefined, null)).toBe(false);
  });

  it("still identifies a run the backend gave no start time", () => {
    expect(discoveryRunId(at({ started_at: null }))).toBe("running");
    expect(discoveryRunId(at({ state: "done" }))).toBe(null);
  });
});

describe("discoveryRunning", () => {
  it("is true only while the run is under way", () => {
    expect(discoveryRunning({ discovery: at() })).toBe(true);
    expect(discoveryRunning({ discovery: at({ state: "skipped" }) })).toBe(false);
    expect(discoveryRunning({ discovery: null })).toBe(false);
    expect(discoveryRunning({})).toBe(false);
  });
});

describe("showLiveDiscoveryNotice", () => {
  it("replaces the gauges only on the Now tab, only while running", () => {
    expect(showLiveDiscoveryNotice(at(), "now")).toBe(true);
    expect(showLiveDiscoveryNotice(at(), "trend")).toBe(false);
    expect(showLiveDiscoveryNotice(at({ state: "done" }), "now")).toBe(false);
    expect(showLiveDiscoveryNotice(at({ state: "skipped" }), "now")).toBe(false);
    expect(showLiveDiscoveryNotice(null, "now")).toBe(false);
  });
});

describe("discoveryPercent", () => {
  it("gives each stage a quarter of the bar", () => {
    expect(discoveryPercent(at({ stage: "census", stage_done: 0, stage_total: 10 }))).toBe(0);
    expect(discoveryPercent(at({ stage: "census", stage_done: 5, stage_total: 10 }))).toBe(13);
    expect(discoveryPercent(at({ stage: "identity", stage_done: 0, stage_total: 8 }))).toBe(25);
    expect(discoveryPercent(at({ stage: "join", stage_done: 0, stage_total: 1 }))).toBe(50);
    expect(discoveryPercent(at({ stage: "coverage", stage_done: 1, stage_total: 1 }))).toBe(100);
  });

  it("never runs past its stage, and is 0 when nothing is running", () => {
    expect(discoveryPercent(at({ stage: "census", stage_done: 99, stage_total: 10 }))).toBe(25);
    expect(discoveryPercent(at({ stage: "census", stage_done: 0, stage_total: 0 }))).toBe(0);
    expect(discoveryPercent(at({ state: "done" }))).toBe(0);
    expect(discoveryPercent(null)).toBe(0);
  });
});
