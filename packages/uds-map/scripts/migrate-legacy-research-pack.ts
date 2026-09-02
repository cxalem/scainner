// One-off migration: a pre-specification research package -> a
// specification-shaped authoring directory.
//
// Two brand packages (`docs/product/research/<brand>-deep-research-v1/`)
// were written before `docs/uds/brand-research-pack-specification.md`
// existed. They carried the same knowledge in a different shape: no
// manifest hashes, `0x`-prefixed addresses, packed `730/748` route
// alternatives, a private protocol vocabulary, a single `decode` per DID
// and no `claims[]`. Two Python scripts used to fold them straight into
// `data/research/existing-brand-hypotheses-v3.json`.
//
// This script replaces those scripts. It reads one legacy directory and
// writes `<brand>-deep-research-v2/` in the canonical shape, so the normal
// pipeline (`research:validate` -> `research:compile`) owns them from here
// on. It is kept in the tree for provenance: it is the record of how the
// v1 content became v2, and it is deterministic, so the output can be
// regenerated and diffed.
//
//   node --experimental-strip-types scripts/migrate-legacy-research-pack.ts \
//     --brand seat \
//     --input ../../docs/product/research/seat-deep-research-v1 \
//     --output ../../docs/product/research/seat-deep-research-v2
//
// Normative contract for the output: docs/uds/brand-research-pack-specification.md.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { validateResearchPack } from "./research-pack.ts";

type Json = Record<string, any>;

/** The day this migration ran and every GitHub blob below was re-resolved. */
const MIGRATION_DATE = "2026-09-02";

// ------------------------------------------------------------ configuration

/**
 * A GitHub source the legacy ledger cited by branch (or by repository root)
 * with the blob digest hidden in a prose `revision` field. Each `sha` here
 * was resolved with
 * `gh api repos/<owner>/<repo>/contents/<path> --jq .sha` on
 * MIGRATION_DATE and matched the digest the legacy package already
 * recorded, so pinning changes the URL, never the evidence.
 *
 * `execution_eligible` is specification §15's gate: only these sources can
 * authorize a route or a DID for automatic execution.
 */
type GitSource = { repo: string; path: string; sha: string; execution_eligible: boolean; source_type?: string };

type DidScope =
  | { kind: "catalogue"; models?: string[] }
  | { kind: "platform"; platform_id: string; marques?: string[]; models?: string[] }
  | { kind: "excluded"; reason: string };

type RouteArray = {
  /** Key of the array inside the legacy `ecu-routes.json`. */
  key: string;
  /** Route id prefix, kept from the legacy delta so ids stay recognizable. */
  prefix: string;
  /** `catalogue` = every CAN platform in the pack; `record` = the record's own `platform`. */
  scope: "catalogue" | "record";
};

type BrandConfig = {
  pack_id: string;
  brand_ids: string[];
  marques: string[];
  brand_label: string;
  /** Prefix for candidate ids and derived route ids. */
  id_prefix: string;
  git_sources: Record<string, GitSource>;
  route_arrays: RouteArray[];
  did_scopes: Record<string, DidScope>;
  /** Legacy platform key -> marque, when the legacy record names one. */
  claims: Json[];
  /** Legacy `decode.formula` records this migration converted by hand. */
  formula_decodes: Record<string, Json>;
  readme_notes: string[];
};

/**
 * Legacy `decode` blocks whose arithmetic lived in a `formula` string. The
 * canonical language has only `scale`/`bias`, so each one was solved once,
 * by hand, and recorded here rather than parsed: a wrong parse of a source
 * formula is a wrong sensor reading.
 */
const SEAT_FORMULA_DECODES: Record<string, Json> = {
  // OVMS: raw / 4.0
  "1E3B": { offset: 0, len: 2, encoding: "be", signed: false, scale: 0.25, bias: 0, unit: "V", quantity: "voltage", label: "HV battery voltage" },
  // OVMS: ((raw - 2044.0) / 4.0) * -1  ->  -0.25 * raw + 511
  "1E3D": { offset: 0, len: 2, encoding: "be", signed: false, scale: -0.25, bias: 511, unit: "A", quantity: "current", label: "HV battery current" },
  // OVMS: raw / 2.5
  "028C": { offset: 0, len: 1, encoding: "be", signed: false, scale: 0.4, bias: 0, unit: "%", quantity: "state_of_charge", label: "HV battery absolute state of charge" },
};

const CONFIG: Record<string, BrandConfig> = {
  seat: {
    pack_id: "seat-deep-research",
    brand_ids: ["seat"],
    marques: ["seat"],
    brand_label: "SEAT",
    id_prefix: "seat",
    git_sources: {
      S01: { repo: "OBDb/SEAT", path: "signalsets/v3/default.json", sha: "3e42a533fb22273ebcc09e03d0769c7bfeeef5a9", execution_eligible: true, source_type: "open_diagnostic_database" },
      S02: { repo: "OBDb/Seat-Leon", path: "signalsets/v3/default.json", sha: "86a877653b8090eb0a25b20f53283a8d5cd4b5c7", execution_eligible: true, source_type: "open_diagnostic_database" },
      S03: { repo: "OBDb/Seat-Ibiza", path: "signalsets/v3/default.json", sha: "7f98a5d6ec28897258644a6909c22b83fd299d09", execution_eligible: true, source_type: "open_diagnostic_database" },
      S04: { repo: "ConnorHowell/vag-uds-ids", path: "readme.md", sha: "27b5431ed22a10a41095517b88dc95b3ae212441", execution_eligible: true, source_type: "community_route_catalogue" },
      S05: { repo: "commaai/opendbc", path: "opendbc/car/volkswagen/values.py", sha: "9a7851b662dd94df155057ad80c4a00f67b630d8", execution_eligible: true, source_type: "open_source_implementation" },
      S06: { repo: "openvehicles/Open-Vehicle-Monitoring-System-3", path: "vehicle/OVMS.V3/components/vehicle_vweup/src/vweup_obd.h", sha: "1a79c553654b4b981c162b6cbb740c9784408d96", execution_eligible: true, source_type: "open_source_implementation" },
      S07: { repo: "openvehicles/Open-Vehicle-Monitoring-System-3", path: "vehicle/OVMS.V3/components/vehicle_vweup/src/vweup_obd.cpp", sha: "e0f36c1f02067ce022c7d65fdd9689b009f32f28", execution_eligible: true, source_type: "open_source_implementation" },
      // The six SEAT model repositories share one empty-signalset blob.
      // Pinning it makes "the source was empty at this revision" checkable;
      // it stays execution-ineligible because emptiness authorizes nothing.
      S27: { repo: "OBDb/Seat-Ateca", path: "signalsets/v3/default.json", sha: "7176ccfbcd8055c9fb74a97f35ef5f197efd1f53", execution_eligible: false, source_type: "source_state_record" },
    },
    route_arrays: [
      { key: "vag_group_route_candidates", prefix: "seat_vag", scope: "catalogue" },
      { key: "seat_mii_electric_exact_routes", prefix: "seat_mii", scope: "record" },
    ],
    did_scopes: {
      seat_make_level_mixed: { kind: "catalogue" },
      seat_leon_model_source: { kind: "catalogue", models: ["leon"] },
      seat_ibiza_model_source: { kind: "catalogue", models: ["ibiza"] },
      seat_mii_electric_shared_up: { kind: "platform", platform_id: "seat_mii_electric_shared_up", models: ["mii_electric"] },
      seat_make_level_unresolved_transport: { kind: "excluded", reason: "transport_normalization_required" },
    },
    formula_decodes: SEAT_FORMULA_DECODES,
    claims: [
      {
        claim_id: "seat.s01.make_level_obdb_fallback",
        exact_claim: "OBDb's SEAT make-level fallback signalset aggregates PQ/MQB/electrified command definitions across SEAT models into one make-wide UDS reference, and itself documents competing interpretations for some DIDs across those platforms.",
        knowledge_state: "community_reported",
        source_fidelity: "medium_high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["seat"], marques: ["seat"] },
        source_refs: ["S01"],
        validation: { source_validation_status: "open_diagnostic_database", project_physical_validation_status: "not_tested" },
        action_if_connected: "Use only as a last-resort candidate after platform-specific and model-specific routes are exhausted; never let a make-level guess overwrite a platform-scoped or project-confirmed finding.",
        promotion_test: "Fingerprint the responding ECU (F187/F191/F195) and reproduce the same route+DID+decoder on a second vehicle of the same platform before promoting to uds-map.json.",
        non_generalization_boundary: "Make-level fallback mixing PQ/MQB/electrified platform decoders; not one universal truth for the marque.",
      },
      {
        claim_id: "seat.s02.leon_signalset",
        exact_claim: "OBDb's Leon default signalset documents model-specific UDS routes and DIDs for that model.",
        knowledge_state: "community_reported",
        source_fidelity: "high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["seat"], marques: ["seat"], models: ["leon"] },
        source_refs: ["S02"],
        validation: { source_validation_status: "open_diagnostic_database", project_physical_validation_status: "not_tested" },
        action_if_connected: "Prioritize over make-level candidates on a confirmed vehicle of this model; still treat DIDs as unverified until read on project hardware.",
        promotion_test: "Read each candidate DID on a physical vehicle of this model in the default session, record the raw payload, and confirm the source decode formula against a reference measurement before promoting.",
        non_generalization_boundary: "One model only; the source's own year filters apply.",
      },
      {
        claim_id: "seat.s03.ibiza_signalset",
        exact_claim: "OBDb's Ibiza default signalset documents model-specific UDS routes and DIDs for that model.",
        knowledge_state: "community_reported",
        source_fidelity: "high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["seat"], marques: ["seat"], models: ["ibiza"] },
        source_refs: ["S03"],
        validation: { source_validation_status: "open_diagnostic_database", project_physical_validation_status: "not_tested" },
        action_if_connected: "Prioritize over make-level candidates on a confirmed vehicle of this model; still treat DIDs as unverified until read on project hardware.",
        promotion_test: "Read each candidate DID on a physical vehicle of this model in the default session, record the raw payload, and confirm the source decode formula against a reference measurement before promoting.",
        non_generalization_boundary: "One model only; the source's own year filters apply.",
      },
      {
        claim_id: "seat.s04.group_uds_route_catalogue",
        exact_claim: "A community extraction of the manufacturer group's diagnostic database catalogues UDS module request/response CAN ID pairs shared across the group's platform family.",
        knowledge_state: "community_reported",
        source_fidelity: "medium",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["seat"], marques: ["seat"] },
        source_refs: ["S04"],
        validation: { source_validation_status: "community_extraction", project_physical_validation_status: "not_tested" },
        action_if_connected: "Treat as a presence probe only: attempt the route, and if it answers, fingerprint before trusting any associated DID.",
        promotion_test: "Confirm the route answers on a physical vehicle, fingerprint the responding ECU, and cross-check against a second group-family vehicle before treating it as brand-confirmed rather than group-inherited.",
        non_generalization_boundary: "A route existing in this catalogue is not proof that a given vehicle carries that ECU.",
      },
      {
        claim_id: "seat.s05.opendbc_platform_classification",
        exact_claim: "opendbc's manufacturer-group platform module classifies platform generations and firmware-query behavior, useful for fingerprinting which platform branch a connected vehicle is on.",
        knowledge_state: "community_reported",
        source_fidelity: "high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["seat"], marques: ["seat"] },
        source_refs: ["S05"],
        validation: { source_validation_status: "operational_open_source_implementation", project_physical_validation_status: "not_tested" },
        action_if_connected: "Use only to help classify which platform branch a connected vehicle is on; never as a route or DID source directly.",
        promotion_test: "Supporting classification context only; confirm any platform assignment it suggests against gateway identity before acting on it.",
        non_generalization_boundary: "Platform classification and firmware query logic; not a route or DID source.",
      },
      {
        claim_id: "seat.s06.mii_electric_ovms_header",
        exact_claim: "OVMS's shared small-EV module defines exact UDS module routes and DIDs for that shared platform, in production use in a real vehicle telemetry project.",
        knowledge_state: "community_reported",
        source_fidelity: "high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["seat"], marques: ["seat"], platform_ids: ["seat_mii_electric_shared_up"] },
        source_refs: ["S06"],
        validation: { source_validation_status: "operational_open_source_implementation", project_physical_validation_status: "not_tested" },
        action_if_connected: "High-fidelity for this exact platform; still unread on project hardware, so treat as a strong candidate, not a confirmed sensor.",
        promotion_test: "Read the candidate DIDs on a physical vehicle of this platform in the default session and compare against the source's own decode behavior before promoting to a trusted decode.",
        non_generalization_boundary: "The shared small-EV platform only; siblings from other marques share it, other platforms do not.",
      },
      {
        claim_id: "seat.s07.mii_electric_ovms_decoder",
        exact_claim: "OVMS's shared small-EV decoder implementation shows the same shared-platform DIDs in live polling use, corroborating the header's route/DID list and supplying the decode arithmetic.",
        knowledge_state: "community_reported",
        source_fidelity: "high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["seat"], marques: ["seat"], platform_ids: ["seat_mii_electric_shared_up"] },
        source_refs: ["S07"],
        validation: { source_validation_status: "operational_open_source_implementation", project_physical_validation_status: "not_tested" },
        action_if_connected: "High-fidelity for this exact platform; still unread on project hardware, so treat as a strong candidate, not a confirmed sensor.",
        promotion_test: "Read the candidate DIDs on a physical vehicle of this platform in the default session and compare against the source's own decode behavior before promoting to a trusted decode.",
        non_generalization_boundary: "The shared small-EV platform only; the source's cell-index reordering is implementation detail, not wire truth.",
      },
    ],
    readme_notes: [
      "The steering-route conflict the v1 README called out is now a `conflicts-and-gaps.json` record that names both route ids instead of prose.",
    ],
  },
  vag: {
    pack_id: "vag-deep-research",
    brand_ids: ["vag"],
    marques: ["volkswagen", "audi"],
    brand_label: "Volkswagen Group",
    id_prefix: "vag",
    git_sources: {
      S01: { repo: "commaai/opendbc", path: "opendbc/car/volkswagen/values.py", sha: "9a7851b662dd94df155057ad80c4a00f67b630d8", execution_eligible: true, source_type: "open_source_implementation" },
      S02: { repo: "ConnorHowell/vag-uds-ids", path: "readme.md", sha: "27b5431ed22a10a41095517b88dc95b3ae212441", execution_eligible: true, source_type: "community_route_catalogue" },
      S03: { repo: "OBDb/Volkswagen", path: "signalsets/v3/default.json", sha: "8ef01ebc34901b6dcefc609c660f8ef9d83773ec", execution_eligible: true, source_type: "open_diagnostic_database" },
      S04: { repo: "OBDb/Audi", path: "signalsets/v3/default.json", sha: "aea720fa676dcf395bafc794ffda4551b284e647", execution_eligible: true, source_type: "open_diagnostic_database" },
      S05: { repo: "OBDb/Volkswagen-ID.4", path: "signalsets/v3/default.json", sha: "42cf4b6db4bff7a40850ba89a3d2e2a692cccd35", execution_eligible: true, source_type: "open_diagnostic_database" },
      S06: { repo: "OBDb/Audi-Q5", path: "tests/test_cases/2015/command_support.yaml", sha: "466b95e6df279b3ff95507d3f039806464fcb75c", execution_eligible: true, source_type: "physical_command_support_matrix" },
      S07: { repo: "OBDb/Audi-RS-e-tron", path: "tests/test_cases/2022/command_support.yaml", sha: "5b24d1995a78a25e300afe7e4288e4399f965023", execution_eligible: true, source_type: "physical_command_support_matrix" },
      S08: { repo: "OBDb/Audi-Q4-e-tron", path: "signalsets/v3/default.json", sha: "ad37e0e5bed5520dd705b2eec65834419137edd1", execution_eligible: true, source_type: "open_diagnostic_database" },
    },
    route_arrays: [{ key: "vag_group_route_candidates", prefix: "vag", scope: "catalogue" }],
    did_scopes: {
      vag_shared_make_level_candidate: { kind: "catalogue" },
      audi_j1: { kind: "platform", platform_id: "audi_j1", marques: ["audi"] },
      audi_mlb: { kind: "platform", platform_id: "audi_mlb", marques: ["audi"] },
      vw_meb_gen1: { kind: "platform", platform_id: "vw_meb_gen1", marques: ["volkswagen"] },
    },
    formula_decodes: {},
    claims: [
      {
        claim_id: "vag.s01.opendbc_platform_classification",
        exact_claim: "opendbc's manufacturer-group platform module classifies platform generations, WMI/chassis and firmware-query behavior, useful for fingerprinting which platform branch a connected vehicle is on.",
        knowledge_state: "community_reported",
        source_fidelity: "high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["vag"], marques: ["volkswagen", "audi"] },
        source_refs: ["S01"],
        validation: { source_validation_status: "operational_open_source_implementation", project_physical_validation_status: "not_tested" },
        action_if_connected: "Use only to help classify which platform branch a connected vehicle is on; never as a route or DID source directly.",
        promotion_test: "Supporting classification context only; confirm any platform assignment it suggests against gateway identity before acting on it.",
        non_generalization_boundary: "Platform classification and firmware query logic; not a route or DID source.",
      },
      {
        claim_id: "vag.s02.group_uds_route_catalogue",
        exact_claim: "A community extraction of the manufacturer group's diagnostic database catalogues UDS module request/response CAN ID pairs shared across the group's platform family.",
        knowledge_state: "community_reported",
        source_fidelity: "medium",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["vag"], marques: ["volkswagen", "audi"] },
        source_refs: ["S02"],
        validation: { source_validation_status: "community_extraction", project_physical_validation_status: "not_tested" },
        action_if_connected: "Treat as a presence probe only: attempt the route, and if it answers, fingerprint before trusting any associated DID.",
        promotion_test: "Confirm the route answers on a physical vehicle, fingerprint the responding ECU, and cross-check against a second group-family vehicle before treating it as marque-confirmed rather than group-inherited.",
        non_generalization_boundary: "A route existing in this catalogue is not proof that a given vehicle carries that ECU.",
      },
      {
        claim_id: "vag.s03.first_marque_make_level_signalset",
        exact_claim: "OBDb's make-level signalset for the group's volume marque aggregates command definitions across its models into one make-wide UDS reference.",
        knowledge_state: "community_reported",
        source_fidelity: "medium_high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["vag"], marques: ["volkswagen"] },
        source_refs: ["S03"],
        validation: { source_validation_status: "open_diagnostic_database", project_physical_validation_status: "not_tested" },
        action_if_connected: "Use only as a last-resort candidate after platform-specific and model-specific routes are exhausted; never let a make-level guess overwrite a platform-scoped or project-confirmed finding.",
        promotion_test: "Fingerprint the responding ECU (F187/F191/F195) and reproduce the same route+DID+decoder on a second vehicle of the same platform before promoting to uds-map.json.",
        non_generalization_boundary: "Make-level fallback mixing platform decoders; not one universal truth for the marque.",
      },
      {
        claim_id: "vag.s04.second_marque_make_level_signalset",
        exact_claim: "OBDb's make-level signalset for the group's premium marque aggregates command definitions across its models into one make-wide UDS reference.",
        knowledge_state: "community_reported",
        source_fidelity: "medium_high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["vag"], marques: ["audi"] },
        source_refs: ["S04"],
        validation: { source_validation_status: "open_diagnostic_database", project_physical_validation_status: "not_tested" },
        action_if_connected: "Use only as a last-resort candidate after platform-specific and model-specific routes are exhausted; never let a make-level guess overwrite a platform-scoped or project-confirmed finding.",
        promotion_test: "Fingerprint the responding ECU (F187/F191/F195) and reproduce the same route+DID+decoder on a second vehicle of the same platform before promoting to uds-map.json.",
        non_generalization_boundary: "Make-level fallback mixing transverse, longitudinal and electric platform decoders; not one universal truth for the marque.",
      },
      {
        claim_id: "vag.s05.meb_gen1_model_signalset",
        exact_claim: "OBDb's signalset for the group's first high-volume electric model documents model and platform-specific UDS routes and DIDs for the first-generation electric platform, including gateway energy-management and charging data.",
        knowledge_state: "community_reported",
        source_fidelity: "high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["vag"], marques: ["volkswagen"], platform_ids: ["vw_meb_gen1"] },
        source_refs: ["S05"],
        validation: { source_validation_status: "open_diagnostic_database", project_physical_validation_status: "not_tested" },
        action_if_connected: "Prioritize over make-level candidates on a confirmed vehicle of this platform; still treat DIDs as unverified until read on project hardware.",
        promotion_test: "Read each candidate DID on a physical vehicle of this platform in the default session, record the raw payload, and confirm the source decode formula against a reference measurement before promoting.",
        non_generalization_boundary: "First-generation electric platform only; the source's own year filters apply.",
      },
      {
        claim_id: "vag.s06.longitudinal_2015_command_support",
        exact_claim: "An OBDb test fixture records a physical command-support matrix for a 2015 longitudinal-platform vehicle: dense engine/transmission UDS/OBD support, and no evidence that transverse or electric body routes apply.",
        knowledge_state: "community_reported",
        source_fidelity: "high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["vag"], marques: ["audi"], platform_ids: ["audi_mlb"], years: { from: 2015, to: 2015 } },
        source_refs: ["S06"],
        validation: { source_validation_status: "physical_command_support_matrix", project_physical_validation_status: "not_tested" },
        action_if_connected: "Treat as physically-observed evidence for this exact platform; still confirm independently on project hardware before trusting a decode.",
        promotion_test: "Reproduce the same route/DID responses on a physical longitudinal-platform vehicle and compare payloads before promoting.",
        non_generalization_boundary: "One tested 2015 longitudinal vehicle only.",
      },
      {
        claim_id: "vag.s07.performance_ev_2022_command_support",
        exact_claim: "An OBDb test fixture records a physical command-support matrix for a 2022 performance-EV platform vehicle, including explicit rejections of many generic group make-level route candidates.",
        knowledge_state: "community_reported",
        source_fidelity: "high",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["vag"], marques: ["audi"], platform_ids: ["audi_j1"], years: { from: 2022, to: 2022 } },
        source_refs: ["S07"],
        validation: { source_validation_status: "physical_command_support_matrix", project_physical_validation_status: "not_tested" },
        action_if_connected: "Treat rejected DIDs as evidence to skip on a confirmed vehicle of this platform; treat supported DIDs as physically-observed evidence, still unverified on project hardware.",
        promotion_test: "Reproduce the same route/DID responses (or the same rejections) on a physical vehicle of this platform before promoting either direction.",
        non_generalization_boundary: "One tested 2022 performance-EV vehicle only. Rejections do not generalize beyond it.",
      },
      {
        claim_id: "vag.s08.premium_meb_model_signalset",
        exact_claim: "OBDb's signalset for the premium marque's electric compact SUV documents model and platform-specific UDS routes and DIDs for that marque's implementation of the shared electric platform.",
        knowledge_state: "community_reported",
        source_fidelity: "medium",
        vehicle_applicability: "untested_by_project",
        scope: { brand_ids: ["vag"], marques: ["audi"], platform_ids: ["audi_meb"] },
        source_refs: ["S08"],
        validation: { source_validation_status: "open_diagnostic_database", project_physical_validation_status: "not_tested" },
        action_if_connected: "Prioritize over make-level candidates on a confirmed vehicle of this platform; still treat DIDs as unverified until read on project hardware.",
        promotion_test: "Read each candidate DID on a physical vehicle of this platform in the default session, record the raw payload, and confirm the source decode formula against a reference measurement before promoting.",
        non_generalization_boundary: "One marque's implementation of the shared electric platform; the source default was sparse at this revision.",
      },
    ],
    readme_notes: [
      "The v1 `command-support-evidence.json` negative records are now specification §14 evidence records with a closed observation status.",
    ],
  },
};

// ------------------------------------------------------------------ helpers

const hex = (value: string): string => (value.toLowerCase().startsWith("0x") ? value.slice(2) : value).toUpperCase();
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** `normalized_vehicle_fact` in research.rs, so model ids match what the runtime compares. */
const modelId = (value: string): string => slug(value);

/**
 * Legacy vocabulary -> specification §4 `knowledge_state`.
 *
 * Nothing here maps to `community_verified`: that state means the same
 * finding reproduced across two or more vehicles, which only the fleet
 * promotion gate can establish. A source being operational, exact or
 * physically tested by its own author says how good the source is, not how
 * widely the finding was reproduced, so it stays `community_reported` and
 * the quality lives in `reliability` / `source_fidelity`. The validator
 * rejects the state outright, and `assertNoFleetPromotion` below is the
 * migrator's own guard.
 */
const KNOWLEDGE_STATE: Record<string, string> = {
  source_confirmed: "community_reported",
  source_confirmed_model_scoped: "community_reported",
  source_confirmed_platform_scoped: "community_reported",
  source_confirmed_platform_route: "community_reported",
  research_candidate_make_level: "research_candidate",
  shared_make_level_research_candidate: "research_candidate",
  vag_group_route_candidate: "research_candidate",
  physically_supported_model_scoped: "community_reported",
  negative_physical_evidence_model_scoped: "community_reported",
  transport_normalization_required: "unknown",
  family_hypothesis: "research_candidate",
  family_candidate: "research_candidate",
  cross_model_family_candidate: "research_candidate",
  oem_confirmed: "oem_confirmed",
};

/** No authored record may claim fleet verification. */
function assertNoFleetPromotion(records: Json[], kind: string): void {
  for (const record of records) {
    if (record.knowledge_state === "community_verified") {
      throw new Error(`${kind} ${record.route_id ?? record.candidate_id ?? record.platform_id ?? record.ecu_family_id ?? record.claim_id} asserts community_verified, which only fleet evidence may set`);
    }
  }
}
const knowledgeState = (legacy: string | undefined, fallback = "research_candidate"): string =>
  (legacy && KNOWLEDGE_STATE[legacy]) || fallback;

/** Legacy transport words -> the two closed §8 vocabularies. */
const RUNTIME_TRANSPORT: Record<string, string> = {
  can11: "can11_500",
  can11_500: "can11_500",
  can11_uds: "can11_500",
  can11_isotp: "can11_500",
  uds_can11: "can11_500",
};
const DOCUMENTED_TRANSPORT: Record<string, string[]> = {
  kline: ["iso9141", "kwp2000"],
  kline_if_supported: ["iso9141", "kwp2000"],
  tp2_0: ["tp2_0"],
  tp1_6: ["tp1_6"],
  tp2_or_uds_by_ecu: ["tp2_0"],
  legacy_vag_transport_possible: ["tp2_0"],
  uds_by_ecu: [],
  do_not_assume_uds: [],
};

/**
 * A plausibility window per unit, so a converted decoder can be projected at
 * all: the compiler defers any variant without a `valid_range`. These are
 * project-side sanity bounds, not source claims, and a unit this table does
 * not know deliberately leaves the variant documentation-only.
 */
const VALID_RANGE: Record<string, { min: number; max: number }> = {
  V: { min: 0, max: 1000 },
  A: { min: -1000, max: 1000 },
  mV: { min: 0, max: 20000 },
  mOhm: { min: 0, max: 1000 },
  W: { min: 0, max: 1000000 },
  kWh: { min: 0, max: 400 },
  degC: { min: -60, max: 200 },
  "%": { min: 0, max: 100 },
  percent: { min: 0, max: 100 },
  km: { min: 0, max: 2000000 },
  liters: { min: 0, max: 200 },
  radian: { min: -12, max: 12 },
};

/** Legacy `encoding` shorthand -> canonical `{len, encoding, signed}`. */
function encodingOf(value: unknown): { len: number; encoding: string; signed: boolean } | null {
  if (typeof value !== "string") return null;
  const match = /^([us])(\d+)(?:_(be|le))?$/.exec(value.toLowerCase());
  if (!match) return null;
  const bits = Number(match[2]);
  if (bits % 8 !== 0 || bits < 8 || bits > 64) return null;
  return { len: bits / 8, encoding: match[3] === "le" ? "le" : "be", signed: match[1] === "s" };
}

/** Which validation recipe a candidate's own words ask for. */
const RECIPE_KEYWORDS: Array<[RegExp, string]> = [
  [/wheel.*speed|speed.*wheel/, "wheel_speed"],
  [/steering/, "steering_angle"],
  [/brake/, "brake_pressure"],
  [/tire|tyre|tpms/, "tpms"],
  [/soc|state_of_charge|charg/, "hv_soc"],
  [/temperature|temp\b|coolant|ambient/, "ambient_cabin_temperature"],
  [/12v/, "12v_voltage_current"],
  [/voltage|current/, "voltage_cross_check"],
];

const readJson = (dir: string, name: string): Json => JSON.parse(readFileSync(join(dir, name), "utf8")) as Json;

/** Sorted stable JSON so a re-run is a no-op diff. */
const writeJson = (dir: string, name: string, value: unknown): void =>
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);

/** `730/748 -> 79A/7B2` is two routes, never one record (§8). */
function expandAlternatives(entries: Json[]): Json[] {
  const out: Json[] = [];
  for (const entry of entries) {
    const requests = String(entry.req).split("/");
    const responses = String(entry.resp).split("/");
    if (requests.length !== responses.length) throw new Error(`unpaired route alternatives: ${JSON.stringify(entry)}`);
    for (let i = 0; i < requests.length; i += 1) out.push({ ...entry, req: requests[i], resp: responses[i] });
  }
  return out;
}

/** `2004-2013 depending model`, `2017+`, `pre-2008 / holdover` -> §7 year bounds. */
function yearsOf(era: unknown): { from: number | null; to: number | null } | undefined {
  if (typeof era !== "string") return undefined;
  const years = [...era.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  if (!years.length) return undefined;
  const min = Math.min(...years);
  const max = Math.max(...years);
  if (/^\s*pre-/i.test(era)) return { from: null, to: min - 1 };
  if (era.includes("+") || max === min) return { from: min, to: null };
  return { from: min, to: max };
}

// ------------------------------------------------------------------- sources

function buildSources(legacy: Json[], config: BrandConfig): { sources: Json[]; immutable: Set<string> } {
  const immutable = new Set<string>();
  const sources = legacy.map((source) => {
    const git = config.git_sources[source.ref];
    const record: Json = {
      ref: source.ref,
      title: source.title,
      url: source.url,
      source_type: git?.source_type ?? source.source_type ?? "reference",
      licence: source.licence,
      revision: null,
      retrieved_at: source.retrieved_at ?? MIGRATION_DATE,
      content_sha256: null,
      scope: source.scope,
      reliability: source.reliability,
      execution_eligible: false,
    };
    if (git) {
      // §15: the digest goes inside the URL, so "which bytes" is not a
      // second field a reader has to trust.
      record.url = `https://github.com/${git.repo}/blob/${git.sha}/${git.path}`;
      record.revision = git.sha;
      record.retrieved_at = MIGRATION_DATE;
      record.execution_eligible = git.execution_eligible;
      immutable.add(source.ref);
      return record;
    }
    if (source.ref === "S00") {
      record.revision = source.revision ?? null;
      record.notes = "Project baseline reference; never a research source for a route or a DID.";
      return record;
    }
    // No revision to pin: publication/retrieval dates are all the source
    // offers, so it can document but never authorize.
    record.notes = "No immutable revision available; documentation-only under specification §15.";
    return record;
  });
  return { sources, immutable };
}

// ----------------------------------------------------------------- platforms

function buildPlatforms(legacy: Json[], config: BrandConfig): Json[] {
  return legacy.map((platform) => {
    const examples: string[] = platform.models_examples ?? platform.examples ?? [];
    const strategy: string[] = platform.transport_strategy ?? platform.transport ?? [];
    const runtime = new Set<string>();
    const documented = new Set<string>();
    for (const word of strategy) {
      const key = slug(word);
      if (RUNTIME_TRANSPORT[key]) runtime.add(RUNTIME_TRANSPORT[key]);
      for (const value of DOCUMENTED_TRANSPORT[key] ?? []) documented.add(value);
    }
    const evidence: Json = platform.evidence ?? {};
    const years = yearsOf(platform.approx_era);
    const marques = platform.brand ? [slug(platform.brand)] : config.marques;
    return {
      platform_id: platform.id,
      scope: {
        brand_ids: config.brand_ids,
        marques,
        models: examples.map(modelId),
        ...(years ? { years } : {}),
      },
      architecture: platform.architecture ?? null,
      transport_candidates: [...runtime].sort(),
      unsupported_transport_candidates: [...documented].sort(),
      gateway_architecture: null,
      security_behavior: [],
      classification_evidence: [],
      // §9 and the pipeline's platform bridge: a pack cannot make itself
      // VIN-selectable. Every platform ships an explicit gap instead.
      vds_patterns: [],
      confidence: evidence.confidence ?? platform.confidence ?? "medium",
      knowledge_state: knowledgeState(evidence.knowledge_state, platform.brand ? "community_reported" : "research_candidate"),
      source_refs: platform.source_refs ?? evidence.source_refs ?? [],
      legacy_status: platform.status ?? null,
      legacy_transport_strategy: strategy,
      legacy_era: platform.approx_era ?? null,
      non_generalization_boundary:
        evidence.non_generalization_boundary ??
        `Exact model/year/module behavior must be observed before anything scoped to ${platform.id} is treated as established.`,
    };
  });
}

// -------------------------------------------------------------------- routes

/** Address pair plus scope: the key a candidate or an evidence record joins on. */
type RouteKey = string;

function main(): void {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!process.argv[i]?.startsWith("--") || process.argv[i + 1] === undefined) {
      throw new Error("usage: migrate-legacy-research-pack --brand <id> --input <dir> --output <dir>");
    }
    args.set(process.argv[i].slice(2), process.argv[i + 1]);
  }
  for (const name of ["brand", "input", "output"]) if (!args.has(name)) throw new Error(`--${name} is required`);
  const config = CONFIG[args.get("brand")!];
  if (!config) throw new Error(`no migration configuration for brand ${args.get("brand")}`);
  const input = resolve(args.get("input")!);
  const output = resolve(args.get("output")!);

  const legacyRoutes = readJson(input, "ecu-routes.json");
  const legacyDids = readJson(input, "did-candidates.json");
  const legacyPlatforms = readJson(input, "platforms.json");
  const legacySources = readJson(input, "source-ledger.json");
  const legacyFamilies = readJson(input, "ecu-family-hypotheses.json");
  const legacyConflicts = readJson(input, "conflicts-and-gaps.json");
  const legacyPlan = readJson(input, "validation-plan.json");
  const legacyPolicy = readJson(input, "transport-session-safety-policy.json");
  const legacyPlaybook = readJson(input, "connection-playbook.json");
  const legacyOverlay = readJson(input, `${args.get("brand")}-profile-overlay.json`);
  let legacyEvidence: Json = {};
  try {
    legacyEvidence = readJson(input, "command-support-evidence.json");
  } catch {
    legacyEvidence = {};
  }

  const { sources, immutable } = buildSources(legacySources.sources ?? [], config);
  const platforms = buildPlatforms(legacyPlatforms.platforms ?? [], config);
  const canPlatformIds = platforms
    .filter((platform) => platform.transport_candidates.includes("can11_500"))
    .map((platform) => platform.platform_id)
    .sort();
  if (canPlatformIds.length < 2) throw new Error("expected more than one CAN platform for the catalogue scope");

  const hasImmutable = (refs: string[] | undefined): boolean => (refs ?? []).some((ref) => immutable.has(ref) && config.git_sources[ref]?.execution_eligible === true);

  const platformModels = new Map<string, string[]>(platforms.map((platform) => [platform.platform_id, platform.scope.models]));
  const platformMarques = new Map<string, string[]>(platforms.map((platform) => [platform.platform_id, platform.scope.marques]));

  const scopeFor = (scope: DidScope, role: string, extraModels?: string[]): Json => {
    if (scope.kind === "platform") {
      const models = [...new Set([...(platformModels.get(scope.platform_id) ?? []), ...(scope.models ?? []), ...(extraModels ?? [])])];
      return {
        brand_ids: config.brand_ids,
        marques: scope.marques ?? platformMarques.get(scope.platform_id) ?? config.marques,
        platform_ids: [scope.platform_id],
        ...(models.length ? { models } : {}),
        ecu_roles: [role],
      };
    }
    const models = [...new Set([...(scope.kind === "catalogue" ? scope.models ?? [] : []), ...(extraModels ?? [])])];
    return {
      brand_ids: config.brand_ids,
      marques: config.marques,
      platform_ids: canPlatformIds,
      ...(models.length ? { models } : {}),
      ecu_roles: [role],
    };
  };

  // ---- routes -------------------------------------------------------------
  const routes: Json[] = [];
  const routeByKey = new Map<RouteKey, Json>();
  const usedRouteIds = new Set<string>();

  const routeKey = (scopeKey: string, req: string, resp: string): RouteKey => `${scopeKey}|${req}|${resp}`;

  const addRoute = (options: {
    scopeKey: string;
    scope: DidScope;
    prefix: string;
    role: string;
    req: string;
    resp: string;
    protocolLabel: string | null;
    readServices: string[];
    sourceRefs: string[];
    confidence: string;
    knowledge: string;
    executableInLegacy: boolean;
    boundary: string;
    derivedFrom?: string;
  }): Json => {
    const key = routeKey(options.scopeKey, options.req, options.resp);
    const existing = routeByKey.get(key);
    if (existing) {
      for (const ref of options.sourceRefs) if (!existing.source_refs.includes(ref)) existing.source_refs.push(ref);
      for (const service of options.readServices) if (!existing.read_services.includes(service)) existing.read_services.push(service);
      return existing;
    }
    // §8: only an explicit "ISO-TP UDS over 11-bit CAN" label becomes a
    // runtime transport. Anything else keeps its words and never generates
    // traffic.
    const isoTpUds = options.protocolLabel === null || /^can11_isotp_uds(_candidate)?$/.test(options.protocolLabel);
    const elevenBit = Number.parseInt(options.req, 16) <= 0x7ff && Number.parseInt(options.resp, 16) <= 0x7ff;
    const protocol = isoTpUds && elevenBit ? "can11_500" : "unknown";
    let id = `${options.prefix}_${slug(options.role)}_${options.req.toLowerCase()}_${options.resp.toLowerCase()}`;
    for (let n = 2; usedRouteIds.has(id); n += 1) id = `${options.prefix}_${slug(options.role)}_${options.req.toLowerCase()}_${options.resp.toLowerCase()}_${n}`;
    usedRouteIds.add(id);
    const authorized = protocol === "can11_500" && options.executableInLegacy && hasImmutable(options.sourceRefs);
    const record: Json = {
      route_id: id,
      scope: scopeFor(options.scope, options.role),
      module_role: options.role,
      route: { protocol, req: options.req, resp: options.resp, target_byte: null, address_extension: null, gateway: null },
      read_services: [...options.readServices],
      session: "default_only",
      requires_identity: true,
      confidence: options.confidence,
      knowledge_state: options.knowledge,
      vehicle_fit: "untested",
      identity_fit: "provisional",
      activation: "disabled",
      source_refs: [...options.sourceRefs],
      automatic_execution_authorized: authorized,
      non_generalization_boundary: options.boundary,
    };
    if (protocol !== "can11_500") {
      record.transport_notes = `Legacy transport label "${options.protocolLabel ?? "unstated"}" could not be mapped to a runtime transport; documentation-only.`;
    }
    if (options.derivedFrom) record.derivation = options.derivedFrom;
    routes.push(record);
    routeByKey.set(key, record);
    return record;
  };

  for (const array of config.route_arrays) {
    for (const entry of expandAlternatives(legacyRoutes[array.key] ?? [])) {
      const scope: DidScope =
        array.scope === "catalogue" ? { kind: "catalogue" } : { kind: "platform", platform_id: entry.platform };
      const scopeKey = array.scope === "catalogue" ? "catalogue" : entry.platform;
      addRoute({
        scopeKey,
        scope,
        prefix: array.prefix,
        role: entry.role,
        req: hex(entry.req),
        resp: hex(entry.resp),
        protocolLabel: entry.protocol ?? null,
        // The legacy arrays state no service; every citing source is a
        // service-22 catalogue, and §16 forbids anything but a read.
        readServices: ["22"],
        sourceRefs: entry.source_refs ?? [],
        confidence: entry.confidence ?? "medium",
        knowledge: knowledgeState(entry.knowledge_state),
        executableInLegacy: entry.automatic_execution_authorized !== false,
        boundary:
          entry.non_generalization_boundary ??
          "Exact platform-scoped route evidence; do not widen to another platform without matching evidence.",
      });
    }
  }

  // ---- DID candidates -----------------------------------------------------
  const candidates: Json[] = [];
  const usedCandidateIds = new Set<string>();
  const excluded: Json[] = [];
  const unconverted: Json[] = [];
  let extendedSessionCandidates = 0;

  const recipeFor = (semantic: string): string | null => {
    for (const [pattern, id] of RECIPE_KEYWORDS) if (pattern.test(semantic)) return id;
    return null;
  };

  /**
   * The legacy `decode` object -> a §12 decoder variant, or nothing. The
   * legacy shape had three dialects (canonical-ish `encoding`+`scale`, a
   * `formula` string, and a bit-oriented `len_bits`/`mul`/`div` form). Only
   * what maps exactly is converted; the rest is preserved verbatim beside
   * the candidate and reported as a gap.
   */
  const signalsOf = (decode: Json, did: string): Json[] | null => {
    const byHand = config.formula_decodes[did];
    if (byHand) return [byHand];
    if (decode.formula) return null;
    const parts: Json[] = decode.signals ?? [decode];
    const signals: Json[] = [];
    for (const part of parts) {
      const unit = part.unit ?? decode.unit;
      let signal: Json | null = null;
      const shorthand = encodingOf(part.encoding);
      if (shorthand) {
        if (!Number.isFinite(part.scale ?? 1) || !Number.isFinite(part.bias ?? 0)) return null;
        signal = { offset: 0, len: shorthand.len, encoding: shorthand.encoding, signed: shorthand.signed, scale: part.scale ?? 1, bias: part.bias ?? 0 };
      } else if (Number.isInteger(part.len_bits)) {
        const bits = part.len_bits as number;
        const offsetBits = (part.offset_bits ?? 0) as number;
        if (bits % 8 !== 0 || bits < 8 || bits > 64 || offsetBits % 8 !== 0 || offsetBits < 0) return null;
        const scale = ((part.mul ?? 1) as number) / ((part.div ?? 1) as number);
        const bias = (part.add ?? 0) as number;
        if (!Number.isFinite(scale) || !Number.isFinite(bias)) return null;
        signal = { offset: offsetBits / 8, len: bits / 8, encoding: "be", signed: false, scale, bias };
      }
      if (!signal) return null;
      if (typeof unit === "string" && unit.length) signal.unit = unit;
      signals.push(signal);
    }
    return signals.length ? signals : null;
  };

  const variantOf = (record: Json, did: string, sourceRefs: string[]): Json | null => {
    const decode: Json | undefined = record.decode;
    if (!decode) return null;
    const signals = signalsOf(decode, did);
    if (!signals) {
      unconverted.push({ did, semantic: record.name ?? null, platform_scope: record.platform_scope, source_decode: decode });
      return null;
    }
    const unit = signals[0].unit;
    const range = typeof unit === "string" ? VALID_RANGE[unit] : undefined;
    return {
      variant_id: `${sourceRefs[0] ?? "S00"}-a`,
      signals,
      sentinel_values: [],
      ...(range ? { valid_range: range } : {}),
      source_refs: sourceRefs,
      ...(range ? {} : { projection_note: `No plausibility window for unit "${String(unit)}"; the variant stays documentation-only.` }),
    };
  };

  const candidateRecords: Json[] = legacyDids.records ?? [];
  for (const record of candidateRecords) {
    const scopeName = record.platform_scope;
    const scope = config.did_scopes[scopeName];
    const route = record.route ?? {};
    if (!scope || scope.kind === "excluded" || !route.req || !route.resp) {
      excluded.push({
        did: record.did,
        semantic: record.name ?? null,
        platform_scope: scopeName,
        reason: !scope || scope.kind === "excluded" ? (scope as any)?.reason ?? "unmapped_platform_scope" : "no_resolved_route_address",
        source_refs: record.source_refs ?? [],
      });
      continue;
    }
    if (record.did_range === true || !/^[0-9A-F]{4}$/.test(hex(String(record.did)))) {
      excluded.push({
        did: record.did,
        semantic: record.name ?? null,
        platform_scope: scopeName,
        reason: "did_range_not_a_single_identifier",
        source_decode: record.decode ?? null,
        source_refs: record.source_refs ?? [],
      });
      continue;
    }
    const req = hex(route.req);
    const resp = hex(route.resp);
    const role = record.module_role ?? "module";
    const scopeKey = scope.kind === "platform" ? scope.platform_id : "catalogue";
    const prefix = scope.kind === "platform" ? slug(scope.platform_id) : config.route_arrays[0].prefix;
    const host = addRoute({
      scopeKey,
      scope,
      prefix,
      role,
      req,
      resp,
      protocolLabel: null,
      readServices: [hex(record.service ?? "0x22")],
      sourceRefs: record.source_refs ?? [],
      confidence: record.confidence ?? "medium",
      knowledge: knowledgeState(record.knowledge_state),
      executableInLegacy: record.automatic_execution_authorized !== false,
      boundary: "Route derived from the DID records that cite it; presence is a hypothesis, not proof the ECU is fitted.",
      derivedFrom: "did-candidates.json",
    });
    const did = hex(String(record.did));
    const sourceRefs: string[] = record.source_refs ?? [];
    const legacySupport = record.support_status;
    const support =
      legacySupport === "supported" || legacySupport === "explicitly_unsupported_on_test_vehicle"
        ? legacySupport
        : record.did_status === "source_observed"
          ? "source_observed"
          : "candidate";
    const semantic = record.name ?? null;
    const variant = variantOf(record, did, sourceRefs);
    const session = String(record.diagnostic_session ?? "");
    if (session.includes("extended") || session.includes("0x03")) extendedSessionCandidates += 1;
    const authorized =
      host.automatic_execution_authorized === true &&
      record.automatic_execution_authorized !== false &&
      hasImmutable(sourceRefs) &&
      !["unsupported", "explicitly_unsupported_on_test_vehicle"].includes(support);
    let id = `${config.id_prefix}.${slug(scopeKey)}.${slug(role)}.${did.toLowerCase()}`;
    for (let n = 2; usedCandidateIds.has(id); n += 1) id = `${config.id_prefix}.${slug(scopeKey)}.${slug(role)}.${did.toLowerCase()}.${n}`;
    usedCandidateIds.add(id);
    const recipe = semantic ? recipeFor(semantic) : null;
    candidates.push({
      candidate_id: id,
      scope: scopeFor(scope, role, scope.kind === "catalogue" ? scope.models : undefined),
      route_id: host.route_id,
      service: hex(record.service ?? "0x22"),
      session: "default",
      did,
      semantic,
      route_status: record.route_status ?? "known_or_candidate",
      did_status: record.did_status ?? "source_observed",
      decode_status: record.decode_status ?? "unknown",
      decoder_variants: variant ? [variant] : [],
      ...(variant ? {} : record.decode ? { source_decode_unconverted: record.decode } : {}),
      validation_recipe_id: recipe,
      support_status: support,
      knowledge_state: knowledgeState(record.knowledge_state),
      vehicle_fit: "untested",
      identity_fit: "provisional",
      activation: "disabled",
      confidence: record.confidence ?? "medium",
      automatic_execution_authorized: authorized,
      source_refs: sourceRefs,
      source_session: record.diagnostic_session ?? null,
      notes: record.notes ?? null,
      non_generalization_boundary:
        record.non_generalization_boundary ??
        "Source-observed identifier; meaning and decoder stay hypotheses until read on project hardware.",
    });
  }

  // ---- command-support evidence ------------------------------------------
  const evidence: Json[] = [];
  const usedEvidenceIds = new Set<string>();
  for (const record of legacyEvidence.negative_records ?? []) {
    const scopeName = record.platform_scope;
    const scope = config.did_scopes[scopeName];
    const route = record.route ?? {};
    const role = record.module_role ?? "module";
    let routeId: string | null = null;
    if (scope && scope.kind === "platform" && route.req && route.resp) {
      routeId = addRoute({
        scopeKey: scope.platform_id,
        scope,
        prefix: slug(scope.platform_id),
        role,
        req: hex(route.req),
        resp: hex(route.resp),
        protocolLabel: null,
        readServices: [hex(record.service ?? "0x22")],
        sourceRefs: record.source_refs ?? [],
        confidence: record.confidence ?? "high",
        knowledge: knowledgeState(record.knowledge_state, "community_reported"),
        executableInLegacy: true,
        boundary: record.non_generalization_boundary ?? "One tested vehicle only.",
        derivedFrom: "command-support-evidence.json",
      }).route_id;
    }
    const did = hex(String(record.did));
    let id = `${slug(scopeName)}_${slug(role)}_${did.toLowerCase()}`;
    for (let n = 2; usedEvidenceIds.has(id); n += 1) id = `${slug(scopeName)}_${slug(role)}_${did.toLowerCase()}_${n}`;
    usedEvidenceIds.add(id);
    evidence.push({
      evidence_id: id,
      scope: scope && scope.kind === "platform" ? scopeFor(scope, role) : { brand_ids: config.brand_ids, marques: config.marques, ecu_roles: [role] },
      ecu_fingerprint: null,
      route_id: routeId,
      service: hex(record.service ?? "0x22"),
      session: "default",
      did,
      adapter: { model: "source-test-tool", firmware: null },
      vehicle_state: "not_recorded_by_source",
      attempts: null,
      outcome: {
        // The source records a support matrix, not a raw frame: the vehicle
        // was asked and did not support the identifier.
        status: "unsupported",
        nrc: null,
        payload_hex: null,
        raw_response_ref: `source:${(record.source_refs ?? ["S00"])[0]}`,
      },
      support_status: record.support_status ?? "explicitly_unsupported_on_test_vehicle",
      source_refs: record.source_refs ?? [],
      ...(route.req && !route.resp
        ? { unresolved_response_address: hex(route.req), note: "The source never resolved a response address for this request, so the record cannot bind to a route." }
        : {}),
      non_generalization_boundary: record.non_generalization_boundary ?? "One tested vehicle only.",
    });
  }
  for (const [name, positive] of Object.entries<Json>(legacyEvidence.positive_examples ?? {})) {
    evidence.push({
      evidence_id: `${slug(name)}_supported_route_families`,
      scope: { brand_ids: config.brand_ids, marques: config.marques },
      ecu_fingerprint: null,
      route_id: null,
      service: "22",
      session: "default",
      did: null,
      adapter: { model: "source-test-tool", firmware: null },
      vehicle_state: "not_recorded_by_source",
      attempts: null,
      outcome: { status: "answered", nrc: null, payload_hex: null, raw_response_ref: `source:${(positive.source_refs ?? ["S00"])[0]}` },
      support_status: "physically_supported_on_test_vehicle",
      source_refs: positive.source_refs ?? [],
      supported_route_families: positive.supported_route_families ?? [],
      interpretation: positive.interpretation ?? null,
      non_generalization_boundary: "One tested vehicle; a supported route family is not a supported identifier.",
    });
  }

  // ---- families and inventories ------------------------------------------
  const routeIdsByPair = new Map<string, string[]>();
  for (const route of routes) {
    const pair = `${route.route.req}->${route.route.resp}`;
    routeIdsByPair.set(pair, [...(routeIdsByPair.get(pair) ?? []), route.route_id]);
  }
  const families = (legacyFamilies.families ?? []).map((family: Json) => {
    const pair = typeof family.route_candidate === "string" ? family.route_candidate.split("->").map((part: string) => hex(part.trim())).join("->") : null;
    const known = new Set(platforms.map((platform) => platform.platform_id));
    const platformIds = (family.platforms ?? []).filter((id: string) => known.has(id));
    return {
      ecu_family_id: family.family_id,
      role: family.role,
      scope: {
        brand_ids: config.brand_ids,
        marques: config.marques,
        ...(platformIds.length ? { platform_ids: platformIds } : {}),
        ecu_roles: [family.role],
      },
      observed_route_ids: pair ? (routeIdsByPair.get(pair) ?? []) : [],
      diagnostic_services: ["22"],
      identity_reference_examples: family.identifiers ?? family.identity_strategy ?? [],
      part_prefix_examples: family.part_prefix_examples ?? [],
      proposed_candidate_ids: [],
      confidence: family.confidence ?? "medium",
      knowledge_state: knowledgeState(family.knowledge_state),
      vehicle_fit: "untested",
      identity_fit: "provisional",
      activation: "disabled",
      source_refs: family.source_refs ?? [],
      promotion_test: "Match compatible part and software fingerprints and reproduce the same route, identifier and decoder on at least two vehicles before treating the family as confirmed.",
      non_generalization_boundary: family.reuse_rule ?? "Family reuse requires a fingerprint match, never a model-name match.",
    };
  });

  const inventories = (readOptional(input, "observed-module-inventories.json").inventories ?? []).map((inventory: Json) => ({
    inventory_id: slug(`${inventory.platform}_${inventory.vehicle}`),
    scope: {
      brand_ids: config.brand_ids,
      marques: config.marques,
      platform_ids: [inventory.platform],
      models: [modelId(inventory.vehicle)],
    },
    kind: "source_module_inventory",
    // The legacy records list the manufacturer's own address bytes, not
    // request/response pairs, so no route id can be claimed here.
    route_ids: [],
    address_bytes_seen: inventory.addresses ?? [],
    vehicle_description: inventory.vehicle,
    chassis: inventory.chassis ?? null,
    source_refs: inventory.source_refs ?? [],
    physical_project_observation: false,
  }));

  // ---- validation plan ----------------------------------------------------
  const recipes: Json[] = [];
  const seenRecipes = new Set<string>();
  const pushRecipe = (id: string, kind: string, state: string, instructions: string[], expected: string[]) => {
    if (seenRecipes.has(id)) return;
    seenRecipes.add(id);
    recipes.push({
      validation_recipe_id: id,
      kind,
      safe_vehicle_state: state,
      instructions,
      expected_behavior: expected,
      reference_signals: [],
      promotion_result: "vehicle_fit_matched",
    });
  };
  // The two legacy plans name the same handful of tests in different words.
  // A legacy test takes the keyword id a candidate will reference when that
  // id is still free, so the recipe a candidate points at is the one with
  // real instructions; anything left over keeps its own id rather than
  // being merged away.
  const legacyTests: Array<{ words: string; instruction: string }> = [
    ...(legacyPlan.recommended_human_tests ?? []).map((test: Json) => ({ words: `${test.signal} ${test.test}`, instruction: String(test.test) })),
    ...(legacyPlan.human_tests ?? []).map((test: unknown) => ({ words: String(test), instruction: String(test) })),
  ];
  for (const test of legacyTests) {
    const keyword = recipeFor(test.words.toLowerCase());
    const id = keyword && !seenRecipes.has(keyword) ? keyword : slug(test.instruction);
    pushRecipe(id, "guided_sequence", /stationary/i.test(test.instruction) ? "stationary" : "controlled_low_speed_private_area", [test.instruction], [
      "the value tracks the action the operator performed",
      "the value returns to its resting state when the action stops",
    ]);
  }
  // Every keyword id a candidate can reference must exist as a recipe.
  for (const [, id] of RECIPE_KEYWORDS) {
    pushRecipe(id, "cross_reference", "stationary", [`Compare the candidate value against an independent reference for ${id.replace(/_/g, " ")}.`], [
      "the value stays within the plausibility window recorded on the decoder variant",
      "the value moves with the reference and not against it",
    ]);
  }
  const validationPlan = {
    schema_version: 1,
    goal: legacyPlan.goal ?? "Promote source hypotheses into vehicle- and family-confirmed knowledge without overwriting stronger evidence.",
    validation_recipes: recipes,
    declared_count: recipes.length,
    test_fleet_priority: legacyPlan.test_fleet_priority ?? legacyPlan.priority_spain_fleet ?? [],
    per_vehicle_sequence: legacyPlan.per_vehicle_sequence ?? [],
    promotion_rules: legacyPlan.promotion_rules ?? {},
  };

  // ---- safety policy ------------------------------------------------------
  const legacyBudgets: Json = legacyPolicy.request_budgets ?? {};
  const wallclockSeconds = Number(legacyBudgets.global?.max_wallclock_ms ?? 0) / 1000;
  const safety = {
    schema_version: 1,
    brand_ids: config.brand_ids,
    central_policy_relationship: "Brand pack may only reduce central limits.",
    source_facts_vs_policy: legacyPolicy.source_facts_vs_policy ?? legacyPolicy.note ?? "Numeric budgets are project policy, not manufacturer specifications.",
    automatic_discovery: {
      read_only: true,
      default_session_only: true,
      max_outstanding_requests: 1,
      passive_capture: "attempt only if the adapter reliably monitors the active pins; otherwise passive_capture_unavailable",
    },
    never_automatic_services: ["10_non_default", "11", "14", "27", "28", "2E", "2F", "31", "34", "35", "36", "37", "3D"],
    // §17: only a narrowing survives the migration. The legacy files spoke
    // in request counts and milliseconds; the one budget that maps onto a
    // central ceiling is the whole-connection wall clock.
    brand_budget_reductions: wallclockSeconds > 0 && wallclockSeconds < 600 ? { whole_automatic_connection_seconds: wallclockSeconds } : {},
    brand_request_budgets: legacyBudgets,
    "29bit_policy": {
      generic_enumeration_authorized: false,
      exact_platform_routes_authorized: [],
      conditions: ["exact platform classification supports the route", "route comes from an immutable licensed source", "full request/response pair is canonical"],
      not_authorized_by: ["11-bit silence", "an unresolved source header notation", "another marque or platform using 29-bit"],
    },
    session_policy: {
      product: "default_only",
      extended_session: "Lab only with an exact route, identifier, fingerprint, immutable source, stationary vehicle and a return to the default session.",
      security_access_after_extended_session: false,
    },
    nrc_policy: legacyPolicy.negative_response_handling ?? legacyPolicy.negative_responses ?? {},
    timeouts: legacyPolicy.timeouts_abort ?? legacyPolicy.timeouts ?? {},
    abort_conditions: legacyPolicy.timeouts_abort?.abort_immediately_on ?? legacyPolicy.abort?.immediate ?? [],
    legacy_transport_detection: legacyPolicy.transport_detection ?? null,
  };

  // ---- conflicts and gaps -------------------------------------------------
  const conflicts = (legacyConflicts.conflicts ?? []).map((conflict: Json) => {
    const record: Json = {
      conflict_id: conflict.id,
      finding: conflict.finding,
      automatic_merge: conflict.automatic_merge ?? "forbidden",
      resolution: conflict.resolution,
      source_refs: conflict.source_refs ?? [],
    };
    // The v1 README stated the steering split in prose. Name both routes so
    // the conflict is checkable rather than readable.
    const steering = routes.filter((route) => route.module_role === "steering_assist" && route.route.req === "712");
    if (conflict.id === "seat_eps_route_712" && steering.length > 1) {
      record.route_ids = steering.map((route) => route.route_id).sort();
      record.finding = `${conflict.finding} Both routes are kept, scoped to the evidence that produced them (${record.route_ids.join(", ")}).`;
    }
    return record;
  });

  const gaps: Json[] = [];
  for (const gap of legacyConflicts.research_gaps ?? []) {
    gaps.push({
      gap_id: slug(gap.topic),
      priority: gap.priority ?? "P2",
      required_evidence: gap.need,
      safe_next_action: `Hold everything this gap touches at documentation-only and collect the evidence first: ${gap.need}`,
      retry_condition: "New evidence of the kind this gap names.",
      source_refs: [],
    });
  }
  for (const platform of platforms) {
    gaps.push({
      gap_id: `${platform.platform_id}_platform_not_vin_selectable`,
      priority: "P1",
      required_evidence: `A VIN descriptor pattern from a confirmed ${platform.platform_id} vehicle, or a normalized vehicle-model fact that selects only this platform.`,
      safe_next_action: `Leave every ${platform.platform_id}-scoped candidate inert; the trusted map decides platform selection, never this pack.`,
      retry_condition: "A confirmed VIN or an unambiguous vehicle-model fact for this platform.",
      source_refs: platform.source_refs,
    });
  }
  if (excluded.length) {
    gaps.push({
      gap_id: "records_excluded_from_the_specification_shape",
      priority: "P1",
      required_evidence: "A single canonical identifier and a resolved request/response pair for each excluded record.",
      safe_next_action: "Keep these records as leads only; they generate no traffic and no candidate.",
      retry_condition: "A capture that resolves the address or splits the range into single identifiers.",
      source_refs: [...new Set(excluded.flatMap((record) => record.source_refs ?? []))].sort(),
      research_leads: excluded,
    });
  }
  if (unconverted.length) {
    gaps.push({
      gap_id: "source_decoders_outside_the_canonical_language",
      priority: "P2",
      required_evidence: "A byte-oriented reading of each source decoder, confirmed against a raw payload from a physical vehicle.",
      safe_next_action: "The identifier stays a candidate; its meaning is displayed as unknown until a canonical decoder replaces the preserved source form.",
      retry_condition: "A raw payload that shows the field layout.",
      source_refs: [],
      research_leads: unconverted,
    });
  }
  gaps.push({
    gap_id: "source_sessions_not_reproduced_in_the_default_session",
    priority: "P2",
    required_evidence: `A default-session read of the ${extendedSessionCandidates} identifiers the sources observed in a non-default session.`,
    safe_next_action: "Ask for them in the default session only, and record a refusal as evidence rather than retrying in another session.",
    retry_condition: "A default-session answer or refusal from a physical vehicle.",
    source_refs: [],
  });

  // ---- overlay, playbook, manifest ---------------------------------------
  const overlay = {
    schema_version: 1,
    artifact_type: "brand_research_hypothesis_overlay",
    authoring_contract: { title: "UDS brand research pack specification", version: "1.0", source: "docs/uds/brand-research-pack-specification.md" },
    brand_ids: config.brand_ids,
    marques: config.marques,
    research_date: MIGRATION_DATE,
    original_research_date: legacyOverlay.research_date ?? null,
    migrated_from: basename(input),
    baseline_reference: legacyOverlay.baseline_reference ?? {},
    merge_mode: "additive_only",
    knowledge_dimensions: {
      knowledge_state: "research_candidate/community_reported/inherited/locally_confirmed/community_verified/oem_confirmed/unknown",
      vehicle_fit: "untested/matched/conflicted/insufficient",
      route_state: "reached/refused/silent/transport_failed/closed",
      identity_fit: "provisional/stable/conflicted",
      activation: "disabled/learning/enabled",
    },
    runtime_recommendation: legacyOverlay.runtime_recommendation ?? {},
    claims: config.claims,
  };

  const playbook = { schema_version: 1, ...legacyPlaybook };

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  for (const [kind, records] of [["route", routes], ["candidate", candidates], ["platform", platforms], ["ecu family", families], ["claim", config.claims]] as Array<[string, Json[]]>) {
    assertNoFleetPromotion(records, kind);
  }

  const files: Array<[string, unknown]> = [
    [`${args.get("brand")}-profile-overlay.json`, overlay],
    ["platforms.json", { schema_version: 1, platforms, declared_count: platforms.length }],
    ["connection-playbook.json", playbook],
    ["transport-session-safety-policy.json", safety],
    ["ecu-routes.json", { schema_version: 1, routes, declared_count: routes.length }],
    ["did-candidates.json", { schema_version: 1, candidates, declared_count: candidates.length }],
    ["command-support-evidence.json", { schema_version: 1, evidence, declared_count: evidence.length }],
    ["ecu-family-hypotheses.json", { schema_version: 1, families, declared_count: families.length }],
    ["observed-module-inventories.json", { schema_version: 1, inventories, declared_count: inventories.length }],
    ["validation-plan.json", validationPlan],
    ["conflicts-and-gaps.json", { schema_version: 1, conflicts, gaps, declared_counts: { conflicts: conflicts.length, gaps: gaps.length } }],
    ["source-ledger.json", { schema_version: 1, sources, declared_count: sources.length }],
  ];
  for (const [name, value] of files) writeJson(output, name, value);

  const executableRoutes = routes.filter((route) => route.automatic_execution_authorized === true).length;
  const executableDids = candidates.filter((candidate) => candidate.automatic_execution_authorized === true).length;
  writeFileSync(join(output, "README.md"), readme(config, args.get("brand")!, input, {
    routes: routes.length,
    executableRoutes,
    candidates: candidates.length,
    executableDids,
    evidence: evidence.length,
    platforms: platforms.length,
    sources: sources.length,
    immutable: immutable.size,
    excluded: excluded.length,
    unconverted: unconverted.length,
    families: families.length,
    inventories: inventories.length,
    recipes: recipes.length,
    conflicts: conflicts.length,
    gaps: gaps.length,
    claims: config.claims.length,
  }));

  const declaredCounts = {
    sources: sources.length,
    platforms: platforms.length,
    routes: routes.length,
    did_candidates: candidates.length,
    command_evidence: evidence.length,
    ecu_families: families.length,
    module_inventories: inventories.length,
    validation_recipes: recipes.length,
    claims: config.claims.length,
    conflicts: conflicts.length,
    gaps: gaps.length,
  };
  const manifest = [...files.map(([name]) => name), "README.md"].sort();
  const index: Json = {
    schema_version: 1,
    pack_id: config.pack_id,
    pack_version: 2,
    research_date: MIGRATION_DATE,
    brand_ids: config.brand_ids,
    marques: config.marques,
    self_hash_policy: "index.json is self-excluded to avoid recursive hashing.",
    files: manifest.map((name) => ({ path: name, sha256: createHash("sha256").update(readFileSync(join(output, name))).digest("hex") })),
    declared_counts: declaredCounts,
    validation: { status: "pending", errors: [], warnings: [] },
  };
  writeJson(output, "index.json", index);
  // The manifest records what `research:validate` said about the directory
  // it describes. index.json excludes itself from hashing, so recording the
  // verdict cannot invalidate the manifest it sits in.
  const verdict = validateResearchPack(output);
  index.validation = { status: verdict.failures.length ? "invalid" : "valid", errors: verdict.failures, warnings: verdict.warnings };
  writeJson(output, "index.json", index);

  process.stdout.write(
    `${config.pack_id} v2 -> ${output}\n` +
      `  routes ${routes.length} (${executableRoutes} executable, ${routes.length - executableRoutes} documentation-only)\n` +
      `  did candidates ${candidates.length} (${executableDids} executable)\n` +
      `  command evidence ${evidence.length}, platforms ${platforms.length}, families ${families.length}, inventories ${inventories.length}\n` +
      `  sources ${sources.length} (${immutable.size} pinned to an immutable revision)\n` +
      `  excluded records ${excluded.length}, unconverted decoders ${unconverted.length}, recipes ${recipes.length}\n`,
  );
}

function readOptional(dir: string, name: string): Json {
  try {
    return readJson(dir, name);
  } catch {
    return {};
  }
}

function readme(config: BrandConfig, brand: string, input: string, counts: Record<string, number>): string {
  return `# ${config.brand_label} deep research v2

**Pack id:** \`${config.pack_id}\` · **Pack version:** 2 · **Migrated:** ${MIGRATION_DATE}
**Authoring contract:** [UDS brand research pack specification](../../../uds/brand-research-pack-specification.md) v1.0

This directory carries the same research as \`${basename(input)}\`, rewritten
into the specification's shape by
\`packages/uds-map/scripts/migrate-legacy-research-pack.ts\`. The evidence did
not change; the shape, the identifiers and the source pins did, which is why
it is a new version rather than an edit of the directory it came from.

## What the migration changed

| v1 | v2 |
|---|---|
| No manifest | \`index.json\` hashes every canonical file with SHA-256 and declares every record count |
| \`0x\`-prefixed, mixed-case addresses | Uppercase hexadecimal without a prefix, one request/response pair per route |
| Packed alternatives such as \`730/748\` | One route record per address pair |
| \`can11_isotp_uds\` / \`_candidate\` | \`can11_500\`, the runtime transport, or documentation-only with the original label kept in \`transport_notes\` |
| Free-text \`knowledge_state\` values | The closed §4 vocabulary, plus \`vehicle_fit\`, \`identity_fit\` and \`activation\` |
| Routes with no ids or scope | \`route_id\`, structured \`scope\`, \`read_services\`, \`session: default_only\` |
| A single \`decode\` per DID | \`decoder_variants[]\` with canonical \`scale\`/\`bias\` signals and a plausibility window |
| Platform \`id\` / \`models_examples\` / \`approx_era\` | \`platform_id\` and a structured scope with normalized model ids and year bounds |
| Sources cited by branch or repository root | URLs pinned to a 40-character blob digest; sources without one are documentation-only |
| No \`claims[]\` | ${counts.claims} claims, one per execution-eligible source, each with an action, a promotion test and a boundary |
${config.readme_notes.map((note) => `\n${note}\n`).join("")}
## What it contains

| Record | Count |
|---|---|
| Routes | ${counts.routes} (${counts.executableRoutes} authorized for automatic execution) |
| DID candidates | ${counts.candidates} (${counts.executableDids} authorized) |
| Command evidence | ${counts.evidence} |
| Platforms | ${counts.platforms} |
| ECU families | ${counts.families} |
| Module inventories | ${counts.inventories} |
| Validation recipes | ${counts.recipes} |
| Conflicts / gaps | ${counts.conflicts} / ${counts.gaps} |
| Sources | ${counts.sources} (${counts.immutable} pinned to an immutable revision) |

## What could not be expressed

- ${counts.excluded} records had no single canonical identifier or no resolved
  response address. They are preserved as research leads in
  \`conflicts-and-gaps.json\` and generate no traffic.
- ${counts.unconverted} source decoders describe a field layout the canonical
  \`scale\`/\`bias\` language cannot state: a repeated array, an unresolved
  scale, a list of what the payload "contains". The identifier survives as a
  candidate; the source form is preserved beside it in
  \`source_decode_unconverted\` and listed as a gap.
- No platform is VIN-selectable from this pack. Every platform ships an
  explicit \`platform_not_vin_selectable\` gap, and the compiler emits
  \`platform-proposals.json\` for a human to review.

## Regenerating

From the repository root:

\`\`\`sh
node --experimental-strip-types \\
  packages/uds-map/scripts/migrate-legacy-research-pack.ts --brand ${brand} \\
  --input docs/product/research/${brand}-deep-research-v1 \\
  --output docs/product/research/${brand}-deep-research-v2
\`\`\`

\`source/\` is the compiler's archive of exactly the files \`index.json\`
declares, written by \`research:compile\` beside the projection report.
`;
}

main();
