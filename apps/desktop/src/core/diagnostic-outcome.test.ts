import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { DiagnosticOutcome } from "@scainner/core";

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
