// `research:validate` over a fictional minimal pack: one fixture that is
// valid, and one mutation per rejection class in specification §6.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatValidationReport, validateResearchPack } from "./research-pack.ts";

const MINI = join(dirname(fileURLToPath(import.meta.url)), "fixtures/research/mini-pack");

type PackEdit = { read: (name: string) => any; write: (name: string, value: unknown) => void; writeRaw: (name: string, value: string) => void };

/** A copy of the valid pack with one mutation applied, manifest hashes refreshed. */
function fixture(mutate: (pack: PackEdit) => void, rehash = true): string {
  const dir = mkdtempSync(join(tmpdir(), "research-pack-"));
  cpSync(MINI, dir, { recursive: true });
  const read = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  const writeRaw = (name: string, value: string) => writeFileSync(join(dir, name), value);
  const write = (name: string, value: unknown) => writeRaw(name, `${JSON.stringify(value, null, 2)}\n`);
  mutate({ read, write, writeRaw });
  if (rehash) {
    const index = read("index.json");
    for (const file of index.files) file.sha256 = createHash("sha256").update(readFileSync(join(dir, file.path))).digest("hex");
    write("index.json", index);
  }
  return dir;
}

const failuresOf = (dir: string): string[] => validateResearchPack(dir).failures;
const rejects = (dir: string, pattern: RegExp) => {
  const failures = failuresOf(dir);
  expect(failures.some((failure) => pattern.test(failure)), `expected a failure matching ${pattern}, got:\n${failures.join("\n") || "(none)"}`).toBe(true);
};

describe("the valid mini pack", () => {
  it("passes with the section 23 report", () => {
    const result = validateResearchPack(MINI);
    expect(result.failures).toEqual([]);
    expect(result.report).toMatchObject({
      pack_id: "examplebrand-deep-research",
      pack_version: 1,
      documentation_only_records: 1,
      executable_routes: 1,
      executable_dids: 1,
      negative_evidence: 1,
      missing_immutable_sources: 0,
      unresolved_references: 0,
      scope_conflicts: 1,
      decoder_variants: 1,
      platforms_without_vin_classifier: 0,
    });
    expect(result.report.valid_records).toBeGreaterThan(0);
    expect(result.report.blocked_transport_records).toBeGreaterThan(0);
    const text = formatValidationReport(result);
    for (const line of ["valid records", "documentation-only records", "executable routes", "executable DIDs", "negative evidence", "blocked transport records", "missing immutable sources", "unresolved references", "scope conflicts", "decoder variants", "platforms without a VIN classifier"]) {
      expect(text).toContain(line);
    }
  });
});

describe("knowledge promotion ownership", () => {
  it("rejects fleet verification authored by research", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].knowledge_state = "community_verified";
        write("ecu-routes.json", routes);
      }),
      /research cannot assert community_verified; only fleet evidence from two or more vehicles may set it/,
    );
  });
});

describe("manifest integrity", () => {
  it("rejects a hash mismatch", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].confidence = "high";
        write("ecu-routes.json", routes);
      }, false),
      /hash mismatch: ecu-routes\.json/,
    );
  });

  it("rejects an unsafe manifest path", () => {
    rejects(
      fixture(({ read, write }) => {
        const index = read("index.json");
        index.files[0].path = "../escape.json";
        write("index.json", index);
      }, false),
      /unsafe manifest path/,
    );
  });

  it("rejects a canonical file the manifest does not list", () => {
    rejects(
      fixture(({ read, write }) => {
        const index = read("index.json");
        index.files = index.files.filter((file: any) => file.path !== "source-ledger.json");
        index.declared_counts.sources = 1;
        write("index.json", index);
      }),
      /manifest is missing the canonical file source-ledger\.json/,
    );
  });
});

describe("duplicate identifiers", () => {
  it("rejects a repeated route id", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes.push({ ...routes.routes[0] });
        routes.declared_count = 3;
        write("ecu-routes.json", routes);
        const index = read("index.json");
        index.declared_counts.routes = 3;
        write("index.json", index);
      }),
      /duplicate route_id examplebrand_gen1_gateway_710_77a/,
    );
  });

  it("rejects a repeated claim id", () => {
    rejects(
      fixture(({ read, write }) => {
        const overlay = read("examplebrand-profile-overlay.json");
        overlay.claims.push({ ...overlay.claims[0] });
        write("examplebrand-profile-overlay.json", overlay);
        const index = read("index.json");
        index.declared_counts.claims = 2;
        write("index.json", index);
      }),
      /duplicate claim_id/,
    );
  });
});

describe("unresolved references", () => {
  it("rejects an unknown source ref", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].source_refs = ["S99"];
        write("ecu-routes.json", routes);
      }),
      /unknown source S99/,
    );
  });

  it("rejects an unknown platform id in a scope", () => {
    rejects(
      fixture(({ read, write }) => {
        const candidates = read("did-candidates.json");
        candidates.candidates[0].scope.platform_ids = ["examplebrand_gen9"];
        write("did-candidates.json", candidates);
      }),
      /unknown platform examplebrand_gen9/,
    );
  });

  it("rejects an unknown route id on a candidate", () => {
    rejects(
      fixture(({ read, write }) => {
        const candidates = read("did-candidates.json");
        candidates.candidates[0].route_id = "examplebrand_gen1_missing";
        write("did-candidates.json", candidates);
      }),
      /unknown route examplebrand_gen1_missing/,
    );
  });

  it("rejects an unknown ecu family id", () => {
    rejects(
      fixture(({ read, write }) => {
        const inventories = read("observed-module-inventories.json");
        inventories.inventories[0].scope.ecu_family_ids = ["examplebrand_missing_family"];
        write("observed-module-inventories.json", inventories);
      }),
      /unknown ecu family examplebrand_missing_family/,
    );
  });
});

describe("declared counts", () => {
  it("rejects a declared count that differs from the array", () => {
    rejects(
      fixture(({ read, write }) => {
        const index = read("index.json");
        index.declared_counts.routes = 9;
        write("index.json", index);
      }),
      /declared routes = 9, actual 2/,
    );
  });
});

describe("canonical enums", () => {
  it("rejects a knowledge state outside the vocabulary", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].knowledge_state = "confirmed";
        write("ecu-routes.json", routes);
      }),
      /knowledge_state "confirmed" is not one of/,
    );
  });

  it("rejects a support status outside the vocabulary", () => {
    rejects(
      fixture(({ read, write }) => {
        const candidates = read("did-candidates.json");
        candidates.candidates[0].support_status = "unsuported";
        write("did-candidates.json", candidates);
      }),
      /support_status "unsuported" is not one of/,
    );
  });

  it("rejects an observation status outside the vocabulary", () => {
    rejects(
      fixture(({ read, write }) => {
        const evidence = read("command-support-evidence.json");
        evidence.evidence[0].outcome.status = "no_reply";
        write("command-support-evidence.json", evidence);
      }),
      /outcome\.status "no_reply" is not one of/,
    );
  });

  it("rejects a transport outside the closed vocabulary", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].route.protocol = "can11_isotp_uds";
        write("ecu-routes.json", routes);
      }),
      /protocol "can11_isotp_uds" is not a runtime or documented transport/,
    );
  });

  it("rejects an unsupported transport authorized for execution", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[1].automatic_execution_authorized = true;
        write("ecu-routes.json", routes);
      }),
      /transport kwp2000 is documentation-only and cannot be authorized/,
    );
  });

  it("rejects a write service listed as a read service", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].read_services = ["2E"];
        write("ecu-routes.json", routes);
      }),
      /read service 2E is never automatic/,
    );
  });
});

describe("addresses and identifiers", () => {
  it("rejects a prefixed, lowercase address", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].route.req = "0x710";
        write("ecu-routes.json", routes);
      }),
      /req "0x710" is not uppercase hex/,
    );
  });

  it("rejects an 11-bit address that does not fit the protocol width", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].route.req = "18DAD2F1";
        write("ecu-routes.json", routes);
      }),
      /req "18DAD2F1" is not uppercase hex of the protocol's width/,
    );
  });

  it("rejects route alternatives packed into one record", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].route.req = "730/748";
        write("ecu-routes.json", routes);
      }),
      /encodes route alternatives/,
    );
  });

  it("rejects a DID that is not four uppercase hex digits", () => {
    rejects(
      fixture(({ read, write }) => {
        const candidates = read("did-candidates.json");
        candidates.candidates[0].did = "2a53";
        write("did-candidates.json", candidates);
      }),
      /did "2a53" is not four uppercase hex digits/,
    );
  });
});

describe("scope shape", () => {
  it("rejects an unknown scope key", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].scope.trim_levels = ["sport"];
        write("ecu-routes.json", routes);
      }),
      /unknown scope key trim_levels/,
    );
  });

  it("rejects a scope id array that is not an array", () => {
    rejects(
      fixture(({ read, write }) => {
        const candidates = read("did-candidates.json");
        candidates.candidates[0].scope.models = "one";
        write("did-candidates.json", candidates);
      }),
      /scope\.models must be an array of ids/,
    );
  });

  it('rejects the literal "unknown" inside an id array', () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].scope.ecu_roles = ["unknown"];
        write("ecu-routes.json", routes);
      }),
      /contains the literal "unknown"/,
    );
  });

  it("rejects malformed year bounds", () => {
    rejects(
      fixture(({ read, write }) => {
        const evidence = read("command-support-evidence.json");
        evidence.evidence[0].scope.years = { from: "2022", to: 2022 };
        write("command-support-evidence.json", evidence);
      }),
      /scope\.years\.from must be an integer or null/,
    );
  });
});

describe("decoders", () => {
  it("rejects a second formula dialect", () => {
    rejects(
      fixture(({ read, write }) => {
        const candidates = read("did-candidates.json");
        const signal = candidates.candidates[0].decoder_variants[0].signals[0];
        delete signal.scale;
        signal.div = 10;
        write("did-candidates.json", candidates);
      }),
      /decoder field "div" is a second formula dialect/,
    );
  });

  it("rejects an unknown decoder field", () => {
    rejects(
      fixture(({ read, write }) => {
        const candidates = read("did-candidates.json");
        candidates.candidates[0].decoder_variants[0].signals[0].endianness = "big";
        write("did-candidates.json", candidates);
      }),
      /unknown decoder field "endianness"/,
    );
  });

  it("rejects an encoding outside the vocabulary", () => {
    rejects(
      fixture(({ read, write }) => {
        const candidates = read("did-candidates.json");
        candidates.candidates[0].decoder_variants[0].signals[0].encoding = "uint16";
        write("did-candidates.json", candidates);
      }),
      /encoding "uint16" is not one of/,
    );
  });
});

describe("execution eligibility", () => {
  it("rejects an authorized route whose source is mutable", () => {
    rejects(
      fixture(({ read, write }) => {
        const ledger = read("source-ledger.json");
        ledger.sources[0].revision = "main";
        ledger.sources[0].url = "https://example.invalid/exampleorg/exampleset/blob/main/signalsets/v3/default.json";
        write("source-ledger.json", ledger);
      }),
      /route examplebrand_gen1_gateway_710_77a: automatic_execution_authorized without a 40-character immutable source revision/,
    );
  });

  it("rejects an authorized candidate that the source calls unsupported", () => {
    rejects(
      fixture(({ read, write }) => {
        const candidates = read("did-candidates.json");
        candidates.candidates[0].support_status = "explicitly_unsupported_on_test_vehicle";
        write("did-candidates.json", candidates);
      }),
      /cannot be automatically executed/,
    );
  });

  it("rejects an authorized candidate on a documentation-only route", () => {
    rejects(
      fixture(({ read, write }) => {
        const candidates = read("did-candidates.json");
        candidates.candidates[0].route_id = "examplebrand_gen1_legacy_kline";
        write("did-candidates.json", candidates);
      }),
      /authorized for execution on documentation-only route/,
    );
  });

  it("rejects a session other than default_only for automatic execution", () => {
    rejects(
      fixture(({ read, write }) => {
        const routes = read("ecu-routes.json");
        routes.routes[0].session = "extended";
        write("ecu-routes.json", routes);
      }),
      /automatic execution requires session "default_only"/,
    );
  });
});

describe("budgets and safety policy", () => {
  it("rejects a budget that widens the central ceiling", () => {
    rejects(
      fixture(({ read, write }) => {
        const safety = read("transport-session-safety-policy.json");
        safety.brand_budget_reductions.whole_automatic_connection_seconds = 900;
        write("transport-session-safety-policy.json", safety);
      }),
      /exceeds the central ceiling 600; a brand pack may only narrow/,
    );
  });

  it("rejects a pack that authorizes generic 29-bit enumeration", () => {
    rejects(
      fixture(({ read, write }) => {
        const safety = read("transport-session-safety-policy.json");
        safety["29bit_policy"].generic_enumeration_authorized = true;
        write("transport-session-safety-policy.json", safety);
      }),
      /generic 29-bit enumeration is deny-by-default/,
    );
  });

  it("rejects a discovery policy that is not read-only", () => {
    rejects(
      fixture(({ read, write }) => {
        const safety = read("transport-session-safety-policy.json");
        safety.automatic_discovery.read_only = false;
        write("transport-session-safety-policy.json", safety);
      }),
      /not read-only\/default-session-only/,
    );
  });
});

describe("malformed input", () => {
  it("rejects a file that does not parse", () => {
    rejects(
      fixture(({ writeRaw }) => {
        writeRaw("platforms.json", "{ not json");
      }),
      /file does not parse: platforms\.json/,
    );
  });
});

describe("VIN classifiers on platforms", () => {
  it("accepts the fixture, where a gap record declares the platform not VIN-selectable", () => {
    const result = validateResearchPack(MINI);
    expect(result.failures).toEqual([]);
    expect(result.warnings.filter((warning) => warning.startsWith("platform_without_vin_classifier"))).toEqual([]);
    expect(result.report.platforms_without_vin_classifier).toBe(0);
  });

  it("warns, without failing, when a platform has neither a pattern nor a gap", () => {
    const dir = fixture(({ read, write }) => {
      const gaps = read("conflicts-and-gaps.json");
      delete gaps.gaps[0].kind;
      write("conflicts-and-gaps.json", gaps);
    });
    const result = validateResearchPack(dir);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toContain(
      "platform_without_vin_classifier: examplebrand_gen1 has neither a vds_patterns entry nor a platform_not_vin_selectable gap, so a VIN alone can never select it",
    );
    expect(result.report.platforms_without_vin_classifier).toBe(1);
    expect(formatValidationReport(result)).toMatch(/platforms without a VIN classifier\s+1/);
  });

  it("does not warn when the platform carries sourced patterns instead of a gap", () => {
    const dir = fixture(({ read, write }) => {
      const gaps = read("conflicts-and-gaps.json");
      delete gaps.gaps[0].kind;
      write("conflicts-and-gaps.json", gaps);
      const platforms = read("platforms.json");
      platforms.platforms[0].vds_patterns = ["^KA1HK", "^(KB1HK|KC1HK)"];
      write("platforms.json", platforms);
    });
    const result = validateResearchPack(dir);
    expect(result.failures).toEqual([]);
    expect(result.warnings.filter((warning) => warning.startsWith("platform_without_vin_classifier"))).toEqual([]);
    expect(result.report.platforms_without_vin_classifier).toBe(0);
  });

  const withPatterns = (patterns: unknown) =>
    fixture(({ read, write }) => {
      const platforms = read("platforms.json");
      platforms.platforms[0].vds_patterns = patterns;
      write("platforms.json", platforms);
    });

  it("rejects an unanchored pattern", () => {
    rejects(withPatterns(["KA1HK"]), /platform examplebrand_gen1: vds_patterns\[0\]: pattern "KA1HK" is not anchored/);
  });

  it("rejects an alternation whose second branch is unanchored", () => {
    rejects(withPatterns(["^KA1HK|KB1HK"]), /has an unanchored alternative "KB1HK"/);
  });

  it("rejects a pattern that matches the empty string", () => {
    rejects(withPatterns(["^.*"]), /vds_patterns\[0\]: pattern "\^\.\*" matches the empty string/);
  });

  it("rejects a pattern outside the shared regex subset the runtime parses", () => {
    rejects(withPatterns(["^KA[A-Z]{2}"]), /uses syntax outside the shared regex subset/);
  });

  it("rejects a literal that cannot occur in a VIN", () => {
    // I, O and Q are excluded from every VIN, so a pattern spelling one is
    // a transcription slip, not a classifier.
    for (const pattern of ["^KAI1", "^KAO1", "^KAQ1"]) {
      rejects(withPatterns([pattern]), /uses syntax outside the shared regex subset/);
    }
  });

  it("rejects a pattern that is not a string", () => {
    rejects(withPatterns([{ pattern: "^KA1HK" }]), /a vds pattern must be a non-empty string/);
  });

  it("rejects patterns declared with no source_refs on the platform", () => {
    rejects(
      fixture(({ read, write }) => {
        const platforms = read("platforms.json");
        platforms.platforms[0].vds_patterns = ["^KA1HK"];
        platforms.platforms[0].source_refs = [];
        write("platforms.json", platforms);
      }),
      /declares vds_patterns with no source_refs; a VIN rule is a sourced claim/,
    );
  });
});

// The projector drops every unauthorized candidate, so a DID a physically
// tested vehicle refused must not reappear in a runtime pack. This walks the
// real authoring directories rather than a fixture: it is the check that the
// negative evidence a pack records actually costs those identifiers their
// place in a plan.
describe("negative command evidence", () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const docs = join(repo, "docs/product/research");
  const NEGATIVE = new Set(["unsupported", "explicitly_unsupported_on_test_vehicle"]);

  /** Authoring directories that compiled to a runtime pack of the same name. */
  const compiledPacks = readdirSync(docs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      authored: [join(docs, entry.name), join(docs, entry.name, "source")].find((dir) => existsSync(join(dir, "index.json"))),
      runtime: join(repo, "packages/uds-map/data/research", `${entry.name}.json`),
    }))
    .filter((pack) => pack.authored && existsSync(pack.runtime));

  it("never reaches the runtime as an executable candidate", () => {
    let checked = 0;
    for (const pack of compiledPacks) {
      const evidence: any[] = JSON.parse(readFileSync(join(pack.authored!, "command-support-evidence.json"), "utf8")).evidence ?? [];
      const disproven = evidence.filter((record) => record.route_id && (NEGATIVE.has(record.support_status) || NEGATIVE.has(record.outcome?.status)));
      const runtime = JSON.parse(readFileSync(pack.runtime, "utf8"));
      const byRoute = new Map<string, any[]>();
      for (const profile of runtime.profiles ?? []) for (const route of profile.routes ?? []) byRoute.set(route.route_id, route.candidate_dids ?? []);
      for (const record of disproven) {
        checked += 1;
        const candidates = byRoute.get(record.route_id) ?? [];
        const offender = candidates.find((candidate) => (typeof candidate === "string" ? candidate : candidate.did) === record.did);
        expect(offender, `${pack.name}: ${record.did} was refused on ${record.route_id} and must not be a runtime candidate`).toBeUndefined();
      }
    }
    expect(checked, "no pack carries route-bound negative evidence to check").toBeGreaterThan(0);
  });
});
