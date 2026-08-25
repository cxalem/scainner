import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { DiagnosticOutcome, DiscoveryReport } from "@scainner/core";

const decode = Schema.decodeUnknownSync(DiagnosticOutcome);

describe("diagnostic outcome wire contract", () => {
  it("decodes structured ECU refusal evidence", () => {
    expect(decode({ status: "refused", service: "14", nrc: 0x22, detail: "conditionsNotCorrect" })).toEqual({
      status: "refused",
      service: "14",
      nrc: 0x22,
      detail: "conditionsNotCorrect",
    });
  });

  it("rejects statuses outside the shared vocabulary", () => {
    expect(() => decode({ status: "failed", service: "14", nrc: null, detail: null })).toThrow();
  });
});

describe("discovery coverage wire contract", () => {
  it("decodes candidate evidence and its derived summary", () => {
    const report = Schema.decodeUnknownSync(DiscoveryReport)({
      outcome: { status: "answered", service: "discovery", nrc: null, detail: null },
      coverage: {
        candidates_total: 2,
        candidates_attempted: 1,
        candidates_skipped: 1,
        profile_candidates: 1,
        profile_reached: 1,
        reached: 1,
        refused: 1,
        timed_out: 0,
        transport_failed: 0,
        malformed: 0,
      },
      module_probes: [
        {
          request_address: "700",
          response_address: "708",
          expected_name: "Engine ECU",
          profile_candidate: true,
          source: "profile",
          outcome: { status: "refused", service: "22", nrc: 0x31, detail: "requestOutOfRange" },
        },
      ],
      modules_found: 1,
      dids_found: 0,
      sensors_added: 0,
      cancelled: true,
      auto_stopped_reason: null,
      was_fast_refresh: false,
    });

    expect(report.coverage.candidates_skipped).toBe(1);
    expect(report.module_probes[0]?.outcome.nrc).toBe(0x31);
  });
});
