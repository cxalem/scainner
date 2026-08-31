#!/usr/bin/env python3
"""Convert docs/product/research/seat-deep-research-v1/ into a delta profile
for packages/uds-map/data/research/existing-brand-hypotheses-v3.json.

This is a worked, one-off conversion — SEAT's package has its own shape — but
the *rules* it enforces are the reusable part for the next brand's research
package. See packages/uds-map/scripts/RESEARCH-INGESTION.md for the checklist
extracted from building this.

Run from the repo root: python3 packages/uds-map/scripts/ingest-seat-research.py
Writes the merged pack back to data/research/existing-brand-hypotheses-v3.json.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "docs/product/research/seat-deep-research-v1"
PACK_PATH = ROOT / "packages/uds-map/data/research/existing-brand-hypotheses-v3.json"

RETRIEVED_AT = "2026-08-30"

# Every source cited below was verified with `gh api repos/<owner>/<repo>/git/blobs/<sha>`
# (S05 and S07 had no revision in the package's own source-ledger.json; resolved
# via `gh api repos/<owner>/<repo>/contents/<path>` for the file's current blob).
CLAIMS = [
    {
        "claim_id": "seat.s01.make_level_obdb_fallback",
        "exact_claim": "OBDb's SEAT make-level fallback (default.json) aggregates PQ/MQB/electrified command definitions across SEAT models into one make-wide UDS reference, and itself documents competing interpretations for some DIDs across those platforms.",
        "knowledge_state": "source_confirmed",
        "source_fidelity": "medium_high",
        "vehicle_applicability": "untested_by_project",
        "scope": "SEAT make-level fallback; mixes PQ/MQB/electrified platform decoders, not one universal SEAT truth.",
        "action_if_connected": "Use only as a last-resort candidate after platform-specific and model-specific routes are exhausted; never let a make-level guess overwrite a platform-scoped or project-confirmed finding.",
        "promotion_test": "Fingerprint the responding ECU (F187/F191/F195) and reproduce the same route+DID+decoder on a second SEAT of the same platform before promoting to uds-map.json.",
        "source": {
            "url": "https://github.com/OBDb/SEAT/blob/3e42a533fb22273ebcc09e03d0769c7bfeeef5a9/default.json",
            "revision": "3e42a533fb22273ebcc09e03d0769c7bfeeef5a9",
            "retrieved_at": RETRIEVED_AT,
            "license": "CC-BY-SA-4.0",
        },
    },
    {
        "claim_id": "seat.s02.leon_signalset",
        "exact_claim": "OBDb's SEAT-Leon default signalset documents model-specific UDS routes and DIDs for the Leon.",
        "knowledge_state": "source_confirmed_model_scoped",
        "source_fidelity": "high",
        "vehicle_applicability": "untested_by_project",
        "scope": "SEAT Leon only; OBDb source year filters apply.",
        "action_if_connected": "Prioritize over make-level candidates on a confirmed Leon; still treat DIDs as unverified until read on project hardware.",
        "promotion_test": "Read each candidate DID on a physical Leon in the default session, record the raw payload, and confirm the OBDb decode formula against a reference measurement before promoting.",
        "source": {
            "url": "https://github.com/OBDb/Seat-Leon/blob/86a877653b8090eb0a25b20f53283a8d5cd4b5c7/signalsets/v3/default.json",
            "revision": "86a877653b8090eb0a25b20f53283a8d5cd4b5c7",
            "retrieved_at": RETRIEVED_AT,
            "license": "CC-BY-SA-4.0",
        },
    },
    {
        "claim_id": "seat.s03.ibiza_signalset",
        "exact_claim": "OBDb's SEAT-Ibiza default signalset documents model-specific UDS routes and DIDs for the Ibiza.",
        "knowledge_state": "source_confirmed_model_scoped",
        "source_fidelity": "high",
        "vehicle_applicability": "untested_by_project",
        "scope": "SEAT Ibiza only; OBDb source year filters apply.",
        "action_if_connected": "Prioritize over make-level candidates on a confirmed Ibiza; still treat DIDs as unverified until read on project hardware.",
        "promotion_test": "Read each candidate DID on a physical Ibiza in the default session, record the raw payload, and confirm the OBDb decode formula against a reference measurement before promoting.",
        "source": {
            "url": "https://github.com/OBDb/Seat-Ibiza/blob/7f98a5d6ec28897258644a6909c22b83fd299d09/signalsets/v3/default.json",
            "revision": "7f98a5d6ec28897258644a6909c22b83fd299d09",
            "retrieved_at": RETRIEVED_AT,
            "license": "CC-BY-SA-4.0",
        },
    },
    {
        "claim_id": "seat.s04.vag_uds_route_catalogue",
        "exact_claim": "A community extraction of VAG's ODIS diagnostic database catalogues UDS module request/response CAN ID pairs shared across the VW/Audi/SEAT/Skoda/Cupra platform family.",
        "knowledge_state": "source_confirmed",
        "source_fidelity": "medium",
        "vehicle_applicability": "untested_by_project",
        "scope": "VAG group route catalogue; not SEAT-specific. A route existing in this catalogue is not proof a given SEAT carries that ECU.",
        "action_if_connected": "Treat as a presence probe only: attempt the route, and if it answers, fingerprint before trusting any associated DID.",
        "promotion_test": "Confirm the route answers on a physical SEAT, fingerprint the responding ECU, and cross-check against a second VAG-family vehicle before treating it as SEAT-confirmed rather than VAG-inherited.",
        "source": {
            "url": "https://github.com/ConnorHowell/vag-uds-ids/blob/27b5431ed22a10a41095517b88dc95b3ae212441/readme.md",
            "revision": "27b5431ed22a10a41095517b88dc95b3ae212441",
            "retrieved_at": RETRIEVED_AT,
            "license": "NOASSERTION",
        },
    },
    {
        "claim_id": "seat.s05.opendbc_vw_platform",
        "exact_claim": "opendbc's Volkswagen platform module classifies VW-group platform generations and firmware-query behavior, useful for fingerprinting which platform branch a connected SEAT is on.",
        "knowledge_state": "source_confirmed",
        "source_fidelity": "high",
        "vehicle_applicability": "untested_by_project",
        "scope": "VW Group platform classification and firmware query logic; supporting context, not a SEAT-specific route or DID source.",
        "action_if_connected": "Use only to help classify which platform branch a connected SEAT is on; never as a route or DID source directly.",
        "promotion_test": "n/a - supporting classification context only, not itself promotable to a route or DID.",
        "source": {
            "url": "https://github.com/commaai/opendbc/blob/9a7851b662dd94df155057ad80c4a00f67b630d8/opendbc/car/volkswagen/values.py",
            "revision": "9a7851b662dd94df155057ad80c4a00f67b630d8",
            "retrieved_at": RETRIEVED_AT,
            "license": "MIT",
        },
    },
    {
        "claim_id": "seat.s06.mii_electric_ovms_header",
        "exact_claim": "OVMS's VW e-Up/SEAT Mii Electric/Skoda Citigo-e iV module defines exact UDS module routes and DIDs for the shared e-Up-platform EV, in production use in a real vehicle telemetry project.",
        "knowledge_state": "source_confirmed_platform_scoped",
        "source_fidelity": "high",
        "vehicle_applicability": "untested_by_project",
        "scope": "SEAT Mii Electric (shared VW e-Up / Skoda Citigo-e iV platform) only.",
        "action_if_connected": "High-fidelity for this exact platform; still unread on project hardware, so treat as a strong candidate, not a confirmed sensor, until a physical Mii Electric is available.",
        "promotion_test": "Read the candidate DIDs on a physical Mii Electric in the default session and compare against OVMS's own decode behavior before promoting to a trusted decode.",
        "source": {
            "url": "https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3/blob/1a79c553654b4b981c162b6cbb740c9784408d96/vehicle/OVMS.V3/components/vehicle_vweup/src/vweup_obd.h",
            "revision": "1a79c553654b4b981c162b6cbb740c9784408d96",
            "retrieved_at": RETRIEVED_AT,
            "license": "MIT",
        },
    },
    {
        "claim_id": "seat.s07.mii_electric_ovms_decoder",
        "exact_claim": "OVMS's VW e-Up/SEAT Mii Electric decoder implementation shows the same shared-platform DIDs in live polling use, corroborating the header's route/DID list.",
        "knowledge_state": "source_confirmed_platform_scoped",
        "source_fidelity": "high",
        "vehicle_applicability": "untested_by_project",
        "scope": "SEAT Mii Electric (shared VW e-Up / Skoda Citigo-e iV platform) only.",
        "action_if_connected": "High-fidelity for this exact platform; still unread on project hardware, so treat as a strong candidate, not a confirmed sensor, until a physical Mii Electric is available.",
        "promotion_test": "Read the candidate DIDs on a physical Mii Electric in the default session and compare against OVMS's own decode behavior before promoting to a trusted decode.",
        "source": {
            "url": "https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3/blob/e0f36c1f02067ce022c7d65fdd9689b009f32f28/vehicle/OVMS.V3/components/vehicle_vweup/src/vweup_obd.cpp",
            "revision": "e0f36c1f02067ce022c7d65fdd9689b009f32f28",
            "retrieved_at": RETRIEVED_AT,
            "license": "MIT",
        },
    },
]
CLAIM_IDS = {c["claim_id"] for c in CLAIMS}

# ecu-routes.json's source_refs -> our claim ids
SOURCE_REF_TO_CLAIM = {
    "S01": "seat.s01.make_level_obdb_fallback",
    "S02": "seat.s02.leon_signalset",
    "S03": "seat.s03.ibiza_signalset",
    "S04": "seat.s04.vag_uds_route_catalogue",
    "S05": "seat.s05.opendbc_vw_platform",
    "S06": "seat.s06.mii_electric_ovms_header",
    "S07": "seat.s07.mii_electric_ovms_decoder",
}


def hexaddr(value: str) -> str:
    """'0x70A' -> '70A'. Rust does u32::from_str_radix(_, 16), no 0x prefix."""
    return value[2:] if value.lower().startswith("0x") else value


def hexdid(value: str) -> str:
    """'0x1014' -> '1014'."""
    return value[2:] if value.lower().startswith("0x") else value


def slug(role: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", role.lower()).strip("_")


def main() -> None:
    routes_data = json.loads((SRC / "ecu-routes.json").read_text())
    did_data = json.loads((SRC / "did-candidates.json").read_text())

    # Group did-candidates by (req, resp). Skip the 3 records the research
    # itself flags automatic_execution_authorized: false (unresolved 29-bit /
    # transport-normalization-required — see conflicts-and-gaps.json P0), and
    # the 2 records flagged did_range: true (a DID *range*, e.g. per-cell
    # battery voltages — this schema's candidate_dids is single-DID only;
    # ranges belong in the trusted map's did_bands[] later, once promoted).
    dids_by_route: dict[tuple[str, str], list[str]] = {}
    claims_by_route: dict[tuple[str, str], set[str]] = {}
    skipped = 0
    for rec in did_data["records"]:
        route = rec.get("route") or {}
        if (
            "req" not in route
            or rec.get("automatic_execution_authorized") is False
            or rec.get("did_range") is True
        ):
            skipped += 1
            continue
        key = (hexaddr(route["req"]).upper(), hexaddr(route["resp"]).upper())
        dids_by_route.setdefault(key, [])
        did = hexdid(rec["did"]).upper()
        if did not in dids_by_route[key]:
            dids_by_route[key].append(did)
        for ref in rec.get("source_refs", []):
            if ref in SOURCE_REF_TO_CLAIM:
                claims_by_route.setdefault(key, set()).add(SOURCE_REF_TO_CLAIM[ref])
    assert skipped == 5, f"expected exactly 5 excluded DID records, got {skipped}"

    def build_route(entry: dict, platform: str, prefix: str) -> dict:
        req = hexaddr(entry["req"]).upper()
        resp = hexaddr(entry["resp"]).upper()
        key = (req, resp)
        claim_ids = set()
        for ref in entry.get("source_refs", []):
            if ref in SOURCE_REF_TO_CLAIM:
                claim_ids.add(SOURCE_REF_TO_CLAIM[ref])
        claim_ids |= claims_by_route.get(key, set())
        assert claim_ids, f"route {key} has no claim"
        return {
            "route_id": f"{prefix}_{slug(entry['role'])}_{req.lower()}_{resp.lower()}",
            "platform": platform,
            # candidate_protocol() only recognizes 5 exact strings; the source
            # package's "can11_isotp_uds[_candidate]" isn't one of them and
            # would silently vanish from every plan (plan.rs:71-79 -> a `None`
            # match hits `continue`, no error). Every req/resp here is <=0x7FF,
            # i.e. genuinely 11-bit, so this is a straight rename, not a guess.
            "protocol": "can11_500",
            "req": req,
            "resp": resp,
            "service": "22",
            "session": "default_only",
            "claim_ids": sorted(claim_ids),
            "candidate_dids": dids_by_route.get(key, []),
        }

    vag_routes = [
        build_route(r, "unknown", "seat_vag")
        for r in routes_data["vag_group_route_candidates"]
    ]
    mii_routes = [
        build_route(r, "seat_mii_electric_shared_up", "seat_mii")
        for r in routes_data["seat_mii_electric_exact_routes"]
    ]
    routes = vag_routes + mii_routes

    ids = [r["route_id"] for r in routes]
    assert len(ids) == len(set(ids)), "duplicate route_id generated"
    for r in routes:
        assert all(cid in CLAIM_IDS for cid in r["claim_ids"])

    profile = {
        "brand_id": "seat",
        "brand_name": "SEAT",
        "status": "platform_and_model_route_candidates",
        "wmis": [],
        "routes": routes,
    }

    pack = json.loads(PACK_PATH.read_text())
    assert pack["pack_id"] == "existing-brand-hypotheses-v3-delta"
    assert not any(p["brand_id"] == "seat" for p in pack["profiles"]), "seat profile already present"
    pack["profiles"].append(profile)
    pack["claims"].extend(CLAIMS)
    pack["version"] += 1
    pack["research_date"] = RETRIEVED_AT

    PACK_PATH.write_text(json.dumps(pack, indent=2) + "\n")
    with_dids = sum(1 for r in routes if r["candidate_dids"])
    total_dids = sum(len(r["candidate_dids"]) for r in routes)
    print(
        f"Wrote {PACK_PATH.relative_to(ROOT)}: pack version -> {pack['version']}, "
        f"+1 profile (seat), +{len(CLAIMS)} claims, +{len(routes)} routes "
        f"({with_dids} carrying {total_dids} candidate DIDs total), "
        f"{skipped} DID records excluded (unauthorized execution / unresolved transport / DID range)."
    )


if __name__ == "__main__":
    main()
