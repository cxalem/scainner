import { describe, expect, it } from "vitest";
import { mapKnowledgeCandidate } from "./sync";

describe("mapKnowledgeCandidate", () => {
  it("maps de-identified knowledge without local ids or raw evidence", () => {
    const mapped = mapKnowledgeCandidate(
      {
        id: 42,
        cloud_id: "candidate-uuid",
        compatibility_key: "family:example",
        scope: "ecu_family",
        family_id: "example",
        module_address: "6A8/688",
        supplier: "Example",
        spare_part_number: "1234",
        hardware_version: "A",
        software_version: "B",
        system_name: "ABS",
        route_json: '{"request_id":"6A8"}',
        did: 61840,
        payload_length: 4,
        knowledge_state: "unknown",
        label: "Status",
        decode_json: null,
        shape_json: null,
        interpretations_json: null,
        confidence: 0.8,
        discriminating_test: null,
        first_observed_at: "2026-09-02 10:00:00",
        last_observed_at: "2026-09-02 10:01:00",
      },
      "user-uuid",
    );

    expect(mapped).toMatchObject({
      id: "candidate-uuid",
      contributor_user_id: "user-uuid",
      compatibility_key: "family:example",
      route: { request_id: "6A8" },
    });
    expect(mapped).not.toHaveProperty("raw_sample");
    expect(mapped).not.toHaveProperty("fingerprint_evidence");
  });
});
