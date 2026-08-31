#!/usr/bin/env python3
"""Convert docs/product/research/vag-deep-research-v1/ into a delta profile
for packages/uds-map/data/research/existing-brand-hypotheses-v3.json.

Same conversion discipline as ingest-seat-research.py (see that file and
RESEARCH-INGESTION.md for the rules this enforces), extended for two things
this package has that SEAT's didn't:

- Platform-scoped DID candidates (vw_meb_gen1, audi_j1, audi_mlb) with no
  dedicated route array to draw from — routes are derived from the distinct
  (platform_scope, req, resp) pairs actually present in did-candidates.json.
- command-support-evidence.json: real negative evidence from two physically
  tested vehicles (2015 Audi Q5, 2022 Audi RS e-tron GT). Folded into the
  matching route's candidate_dids with support_status =
  "explicitly_unsupported_on_test_vehicle" (the runtime already refuses to
  execute that status — see CandidateDid::executable() in research.rs).

Run from the repo root: python3 packages/uds-map/scripts/ingest-vag-research.py
Writes the merged pack back to data/research/existing-brand-hypotheses-v3.json.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "docs/product/research/vag-deep-research-v1"
PACK_PATH = ROOT / "packages/uds-map/data/research/existing-brand-hypotheses-v3.json"

RETRIEVED_AT = "2026-08-31"

# Every source below was verified with `gh api repos/<owner>/<repo>/git/blobs/<sha>`
# (S01/S02 reuse the exact hashes already verified for SEAT's S05/S04 — same
# files, same repos). S03-S07 had no revision in this package's own
# source-ledger.json; resolved via `gh api repos/<owner>/<repo>/contents/<path>`.
CLAIMS = [
    {
        "claim_id": "vag.s01.opendbc_platform_classification",
        "exact_claim": "opendbc's Volkswagen platform module classifies VW/Audi platform generations, WMI/chassis and firmware-query behavior, useful for fingerprinting which platform branch a connected VAG vehicle is on.",
        "knowledge_state": "source_confirmed",
        "source_fidelity": "high",
        "vehicle_applicability": "untested_by_project",
        "scope": "VW/Audi platform classification and firmware query logic; supporting context, not a route or DID source directly.",
        "action_if_connected": "Use only to help classify which platform branch a connected VAG vehicle is on; never as a route or DID source directly.",
        "promotion_test": "n/a - supporting classification context only, not itself promotable to a route or DID.",
        "source": {
            "url": "https://github.com/commaai/opendbc/blob/9a7851b662dd94df155057ad80c4a00f67b630d8/opendbc/car/volkswagen/values.py",
            "revision": "9a7851b662dd94df155057ad80c4a00f67b630d8",
            "retrieved_at": RETRIEVED_AT,
            "license": "MIT",
        },
    },
    {
        "claim_id": "vag.s02.vag_uds_route_catalogue",
        "exact_claim": "A community extraction of VAG's ODIS diagnostic database catalogues UDS module request/response CAN ID pairs shared across the VW/Audi/SEAT/Skoda/Cupra platform family.",
        "knowledge_state": "source_confirmed",
        "source_fidelity": "medium",
        "vehicle_applicability": "untested_by_project",
        "scope": "VAG group route catalogue; not brand-specific. A route existing in this catalogue is not proof a given VW/Audi carries that ECU.",
        "action_if_connected": "Treat as a presence probe only: attempt the route, and if it answers, fingerprint before trusting any associated DID.",
        "promotion_test": "Confirm the route answers on a physical VW/Audi, fingerprint the responding ECU, and cross-check against a second VAG-family vehicle before treating it as brand-confirmed rather than group-inherited.",
        "source": {
            "url": "https://github.com/ConnorHowell/vag-uds-ids/blob/27b5431ed22a10a41095517b88dc95b3ae212441/readme.md",
            "revision": "27b5431ed22a10a41095517b88dc95b3ae212441",
            "retrieved_at": RETRIEVED_AT,
            "license": "NOASSERTION",
        },
    },
    {
        "claim_id": "vag.s03.vw_make_level_signalset",
        "exact_claim": "OBDb's Volkswagen make-level signalset aggregates command definitions across VW models into one make-wide UDS reference.",
        "knowledge_state": "source_confirmed",
        "source_fidelity": "medium_high",
        "vehicle_applicability": "untested_by_project",
        "scope": "VW make-level fallback; mixes platform decoders, not one universal VW truth.",
        "action_if_connected": "Use only as a last-resort candidate after platform-specific and model-specific routes are exhausted; never let a make-level guess overwrite a platform-scoped or project-confirmed finding.",
        "promotion_test": "Fingerprint the responding ECU (F187/F191/F195) and reproduce the same route+DID+decoder on a second VW of the same platform before promoting to uds-map.json.",
        "source": {
            "url": "https://github.com/OBDb/Volkswagen/blob/8ef01ebc34901b6dcefc609c660f8ef9d83773ec/signalsets/v3/default.json",
            "revision": "8ef01ebc34901b6dcefc609c660f8ef9d83773ec",
            "retrieved_at": RETRIEVED_AT,
            "license": "CC-BY-SA-4.0",
        },
    },
    {
        "claim_id": "vag.s04.audi_make_level_signalset",
        "exact_claim": "OBDb's Audi make-level signalset aggregates command definitions across Audi models into one make-wide UDS reference.",
        "knowledge_state": "source_confirmed",
        "source_fidelity": "medium_high",
        "vehicle_applicability": "untested_by_project",
        "scope": "Audi make-level fallback; mixes platform decoders (MQB/MLB/MEB/J1), not one universal Audi truth.",
        "action_if_connected": "Use only as a last-resort candidate after platform-specific and model-specific routes are exhausted; never let a make-level guess overwrite a platform-scoped or project-confirmed finding.",
        "promotion_test": "Fingerprint the responding ECU (F187/F191/F195) and reproduce the same route+DID+decoder on a second Audi of the same platform before promoting to uds-map.json.",
        "source": {
            "url": "https://github.com/OBDb/Audi/blob/aea720fa676dcf395bafc794ffda4551b284e647/signalsets/v3/default.json",
            "revision": "aea720fa676dcf395bafc794ffda4551b284e647",
            "retrieved_at": RETRIEVED_AT,
            "license": "CC-BY-SA-4.0",
        },
    },
    {
        "claim_id": "vag.s05.vw_id4_meb_signalset",
        "exact_claim": "OBDb's Volkswagen ID.4 signalset documents model/platform-specific UDS routes and DIDs for the MEB Gen1 platform, including gateway energy-management and charging data.",
        "knowledge_state": "source_confirmed_model_scoped",
        "source_fidelity": "high",
        "vehicle_applicability": "untested_by_project",
        "scope": "VW ID.4 / MEB Gen1 only; OBDb source year filters apply.",
        "action_if_connected": "Prioritize over make-level candidates on a confirmed MEB Gen1 vehicle; still treat DIDs as unverified until read on project hardware.",
        "promotion_test": "Read each candidate DID on a physical ID.4 in the default session, record the raw payload, and confirm the OBDb decode formula against a reference measurement before promoting.",
        "source": {
            "url": "https://github.com/OBDb/Volkswagen-ID.4/blob/42cf4b6db4bff7a40850ba89a3d2e2a692cccd35/signalsets/v3/default.json",
            "revision": "42cf4b6db4bff7a40850ba89a3d2e2a692cccd35",
            "retrieved_at": RETRIEVED_AT,
            "license": "CC-BY-SA-4.0",
        },
    },
    {
        "claim_id": "vag.s06.audi_q5_2015_command_support",
        "exact_claim": "OBDb's Audi Q5 2015 test fixture records a physical command-support matrix for a longitudinal-platform (MLB) Audi: dense engine/transmission UDS/OBD support, and does not assume MQB/MEB body/EV routes apply.",
        "knowledge_state": "vehicle_confirmed",
        "source_fidelity": "high",
        "vehicle_applicability": "partially_project_confirmed",
        "scope": "2015 Audi Q5 / MLB longitudinal only.",
        "action_if_connected": "Treat as physically-observed evidence for this exact platform; still confirm independently on project hardware before trusting a decode.",
        "promotion_test": "Reproduce the same route/DID responses on a physical MLB-platform Audi and compare payloads before promoting.",
        "source": {
            "url": "https://github.com/OBDb/Audi-Q5/blob/466b95e6df279b3ff95507d3f039806464fcb75c/tests/test_cases/2015/command_support.yaml",
            "revision": "466b95e6df279b3ff95507d3f039806464fcb75c",
            "retrieved_at": RETRIEVED_AT,
            "license": "CC-BY-SA-4.0",
        },
    },
    {
        "claim_id": "vag.s07.audi_rs_etron_gt_2022_command_support",
        "exact_claim": "OBDb's Audi RS e-tron GT 2022 test fixture records a physical command-support matrix for the J1 performance-EV platform, including explicit rejections of many generic VAG make-level route candidates.",
        "knowledge_state": "vehicle_confirmed",
        "source_fidelity": "high",
        "vehicle_applicability": "partially_project_confirmed",
        "scope": "2022 Audi RS e-tron GT / J1 only. Rejections do not generalize beyond this exact tested vehicle.",
        "action_if_connected": "Treat rejected DIDs as evidence to skip on a confirmed J1 vehicle; treat supported DIDs as physically-observed evidence, still unverified on project hardware.",
        "promotion_test": "Reproduce the same route/DID responses (or the same rejections) on a physical J1-platform Audi before promoting either direction.",
        "source": {
            "url": "https://github.com/OBDb/Audi-RS-e-tron/blob/5b24d1995a78a25e300afe7e4288e4399f965023/tests/test_cases/2022/command_support.yaml",
            "revision": "5b24d1995a78a25e300afe7e4288e4399f965023",
            "retrieved_at": RETRIEVED_AT,
            "license": "CC-BY-SA-4.0",
        },
    },
    {
        "claim_id": "vag.s08.audi_q4_etron_meb_signalset",
        "exact_claim": "OBDb's Audi Q4 e-tron signalset documents model/platform-specific UDS routes and DIDs for Audi's MEB implementation.",
        "knowledge_state": "source_confirmed_model_scoped",
        "source_fidelity": "high",
        "vehicle_applicability": "untested_by_project",
        "scope": "Audi Q4 e-tron / MEB only; OBDb source year filters apply.",
        "action_if_connected": "Prioritize over make-level candidates on a confirmed Audi MEB vehicle; still treat DIDs as unverified until read on project hardware.",
        "promotion_test": "Read each candidate DID on a physical Q4 e-tron in the default session, record the raw payload, and confirm the OBDb decode formula against a reference measurement before promoting.",
        "source": {
            "url": "https://github.com/OBDb/Audi-Q4-e-tron/blob/ad37e0e5bed5520dd705b2eec65834419137edd1/signalsets/v3/default.json",
            "revision": "ad37e0e5bed5520dd705b2eec65834419137edd1",
            "retrieved_at": RETRIEVED_AT,
            "license": "CC-BY-SA-4.0",
        },
    },
]
CLAIM_IDS = {c["claim_id"] for c in CLAIMS}

SOURCE_REF_TO_CLAIM = {
    "S01": "vag.s01.opendbc_platform_classification",
    "S02": "vag.s02.vag_uds_route_catalogue",
    "S03": "vag.s03.vw_make_level_signalset",
    "S04": "vag.s04.audi_make_level_signalset",
    "S05": "vag.s05.vw_id4_meb_signalset",
    "S06": "vag.s06.audi_q5_2015_command_support",
    "S07": "vag.s07.audi_rs_etron_gt_2022_command_support",
    "S08": "vag.s08.audi_q4_etron_meb_signalset",
}


def hexaddr(value: str) -> str:
    return value[2:] if value.lower().startswith("0x") else value


def hexdid(value: str) -> str:
    return value[2:] if value.lower().startswith("0x") else value


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def expand_route_alternatives(entries: list[dict]) -> list[dict]:
    """Turn source shorthand `730/748 -> 79A/7B2` into two real routes.
    Same fix as ingest-seat-research.py (this package reuses the identical
    86-route VAG catalogue, including the same two alternate-address routes)."""
    expanded = []
    for entry in entries:
        requests = entry["req"].split("/")
        responses = entry["resp"].split("/")
        assert len(requests) == len(responses), f"unpaired route alternatives: {entry}"
        for req, resp in zip(requests, responses):
            route = dict(entry)
            route["req"] = req
            route["resp"] = resp
            expanded.append(route)
    return expanded


def claim_ids_for(source_refs: list[str]) -> set[str]:
    return {SOURCE_REF_TO_CLAIM[s] for s in source_refs if s in SOURCE_REF_TO_CLAIM}


def build_candidate_did(did_hex: str, semantic: str | None, decode: object | None, support_status: str | None) -> dict:
    obj: dict = {"did": did_hex}
    if semantic:
        obj["semantic"] = semantic
    if decode is not None:
        obj["decode"] = decode
    if support_status:
        obj["support_status"] = support_status
    return obj


def main() -> None:
    routes_data = json.loads((SRC / "ecu-routes.json").read_text())
    did_data = json.loads((SRC / "did-candidates.json").read_text())
    evidence_data = json.loads((SRC / "command-support-evidence.json").read_text())

    # route_key -> { platform, module_role, candidate_dids: {did_hex: obj}, claim_refs }
    routes: dict[tuple[str, str, str], dict] = {}

    def get_route(platform: str, req_raw: str, resp_raw: str, module_role: str | None) -> dict:
        req, resp = hexaddr(req_raw).upper(), hexaddr(resp_raw).upper()
        key = (platform, req, resp)
        if key not in routes:
            routes[key] = {
                "platform": platform,
                "req": req,
                "resp": resp,
                "module_role": module_role,
                "candidate_dids": {},  # did_hex -> obj, last-write-wins per field group
                "claim_ids": set(),
            }
        elif module_role and not routes[key]["module_role"]:
            routes[key]["module_role"] = module_role
        return routes[key]

    # 1. Make-level (platform: unknown) presence probes from the 86-route
    #    catalogue. No candidate_dids of their own yet - did-candidates.json's
    #    "vag_shared_make_level_candidate" records attach to these below.
    for entry in expand_route_alternatives(routes_data["vag_group_route_candidates"]):
        r = get_route("unknown", entry["req"], entry["resp"], entry.get("role"))
        r["claim_ids"] |= claim_ids_for(entry.get("source_refs", []))

    # 2. did-candidates.json: 217 records. None flagged did_range or
    #    automatic_execution_authorized: false in this package (verified
    #    before writing this script) - nothing to exclude on that basis.
    #    "vag_shared_make_level_candidate" joins the make-level routes above;
    #    everything else gets its own platform-scoped route (this package has
    #    no separate platform route array to draw from, unlike SEAT's Mii
    #    Electric routes - the platform-scoped route set is exactly the
    #    distinct (platform_scope, req, resp) pairs used here).
    skipped = 0
    for rec in did_data["records"]:
        route = rec.get("route") or {}
        if "req" not in route or not route.get("resp"):
            skipped += 1
            continue
        scope = rec["platform_scope"]
        platform = "unknown" if scope == "vag_shared_make_level_candidate" else scope
        r = get_route(platform, route["req"], route["resp"], rec.get("module_role"))
        did_hex = hexdid(rec["did"]).upper()
        r["candidate_dids"][did_hex] = build_candidate_did(
            did_hex, rec.get("name"), rec.get("decode"), rec.get("support_status")
        )
        r["claim_ids"] |= claim_ids_for(rec.get("source_refs", []))

    # 3. command-support-evidence.json negative_records: real per-DID
    #    rejections from a physically tested J1 vehicle. 4 of 22 have no
    #    response address (req 0x70B, resp null - the TPMS response ID was
    #    never resolved even on the test vehicle) and cannot become a route;
    #    those stay documented in the source folder only, not ingested here.
    negative_skipped = 0
    for rec in evidence_data.get("negative_records", []):
        route = rec.get("route") or {}
        if not route.get("req") or not route.get("resp"):
            negative_skipped += 1
            continue
        r = get_route(rec["platform_scope"], route["req"], route["resp"], rec.get("module_role"))
        did_hex = hexdid(rec["did"]).upper()
        # Physical negative evidence overrides any community-sourced guess
        # for the same DID (spec section 21: "physical evidence wins without
        # deleting the older observation" - here there's nothing to delete,
        # this is the only record ingested for this did on this route).
        r["candidate_dids"][did_hex] = build_candidate_did(
            did_hex, None, None, rec["support_status"]
        )
        r["claim_ids"] |= claim_ids_for(rec.get("source_refs", []))
    assert negative_skipped == 4, f"expected exactly 4 unroutable negative records, got {negative_skipped}"

    out_routes = []
    seen_ids: set[str] = set()
    for (platform, req, resp), r in sorted(routes.items()):
        assert r["claim_ids"], f"route {platform}/{req}/{resp} has no claim"
        role = r["module_role"] or "module"
        prefix = "vag" if platform == "unknown" else slug(platform)
        route_id = f"{prefix}_{slug(role)}_{req.lower()}_{resp.lower()}"
        base_id = route_id
        n = 2
        while route_id in seen_ids:
            route_id = f"{base_id}_{n}"
            n += 1
        seen_ids.add(route_id)
        out_routes.append(
            {
                "route_id": route_id,
                "platform": platform,
                "protocol": "can11_500",
                "req": req,
                "resp": resp,
                "service": "22",
                "session": "default_only",
                "claim_ids": sorted(r["claim_ids"]),
                "candidate_dids": [r["candidate_dids"][k] for k in sorted(r["candidate_dids"])],
            }
        )

    profile = {
        "brand_id": "vag",
        "brand_name": "Volkswagen Group (VW, Audi)",
        "status": "platform_and_model_route_candidates",
        "wmis": [],
        "routes": out_routes,
    }

    pack = json.loads(PACK_PATH.read_text())
    assert pack["pack_id"] == "existing-brand-hypotheses-v3-delta"
    assert not any(p["brand_id"] == "vag" for p in pack["profiles"]), "vag profile already present"
    pack["profiles"].append(profile)
    pack["claims"].extend(CLAIMS)
    pack["version"] += 1
    pack["research_date"] = RETRIEVED_AT

    PACK_PATH.write_text(json.dumps(pack, indent=2) + "\n")
    with_dids = sum(1 for r in out_routes if r["candidate_dids"])
    total_dids = sum(len(r["candidate_dids"]) for r in out_routes)
    neg = sum(
        1
        for r in out_routes
        for d in r["candidate_dids"]
        if d.get("support_status") == "explicitly_unsupported_on_test_vehicle"
    )
    print(
        f"Wrote {PACK_PATH.relative_to(ROOT)}: pack version -> {pack['version']}, "
        f"+1 profile (vag), +{len(CLAIMS)} claims, +{len(out_routes)} routes "
        f"({with_dids} carrying {total_dids} candidate DIDs, {neg} of them "
        f"physically-confirmed negative evidence), {skipped} did-candidates "
        f"records excluded (no route address), {negative_skipped} negative "
        f"records excluded (no response address)."
    )


if __name__ == "__main__":
    main()
