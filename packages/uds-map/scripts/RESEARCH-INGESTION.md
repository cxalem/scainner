# Turning a brand deep-research package into a live research-candidate delta

The normative authoring, safety and runtime-projection contract is
[`docs/uds/brand-research-pack-specification.md`](../../../docs/uds/brand-research-pack-specification.md).
This file is the practical procedure for the current v1 projection format.

The discovery engine already has a safety-gated pipeline for exactly this
(`apps/desktop/src-tauri/src/elm/discovery/research.rs`), used today by
Porsche, BYD, Subaru, PSA, Mazda, Škoda and others. Getting a new brand's
research package into it is normally a **pure data change** — a new
`profile` (routes) plus a handful of `claims` (evidence) appended to
`packages/uds-map/data/research/existing-brand-hypotheses-v3.json` (an
existing brand already in `uds-map.json`, getting a delta — this is the
common case) or `research-candidates-v2.json` (a brand with no `uds-map.json`
entry at all yet). **No Rust code change is needed** unless you're adding a
brand-new pack *file* — see `ingest-seat-research.py` for a worked example
(SEAT → `existing-brand-hypotheses-v3.json`, version bumped in place).

Rules the pipeline enforces at startup (`research.rs::packs()`, hard
`assert!`s — get any of these wrong and the binary won't build, or worse, a
route silently vanishes with no error):

1. **`protocol` must be exactly one of**: `can11_500`, `can11_250`,
   `can29_normal_fixed`, `can29_target_byte`, `can29_custom`
   (`plan.rs::candidate_protocol`). A research package's own protocol label
   ("can11_isotp_uds", "ISO-TP UDS", …) is almost never one of these —
   translate it. **This one fails silently**: an unrecognized string doesn't
   panic or error, the route just never gets added to any plan
   (`plan.rs`: `let (Some(protocol), ...) = (...) else { continue; }`). Test
   by hand after ingesting — a route count of zero from
   `routes_for_context` is the symptom.
2. **`service` must be `"22"`, `session` must be `"default_only"`** (no `0x`
   prefix, exact strings) — enforced by
   `every_route_has_claims_and_only_read_service_22`.
3. **Every route needs at least one `claim_id`**, and every `claim_id` it
   lists must exist in the same pack's `claims[]`.
4. **`claim.source.revision` must be a 40-character hex string, and
   `claim.source.url` must contain that exact string** — i.e. a real git
   blob or commit SHA embedded in a `/blob/<sha>/<path>` URL, not `main` or
   `master`. If the research package's own source ledger has a revision,
   verify it before trusting it — a blob SHA doesn't resolve through
   GitHub's *commits* API, only `git/blobs`:
   `gh api repos/<owner>/<repo>/git/blobs/<sha>`. If the ledger has no
   revision (`null`) for a source, resolve the file's current blob SHA
   yourself: `gh api repos/<owner>/<repo>/contents/<path> --jq '.sha'`, then
   build the URL from that.
5. **`vehicle_applicability` must be exactly `"untested_by_project"` or
   `"partially_project_confirmed"`** — nothing else passes
   `sources_are_immutable_and_claim_ids_are_unique`.
6. **If you're extending `existing-brand-hypotheses-v3-delta`** specifically
   (by its exact `pack_id`), every claim also needs non-empty
   `action_if_connected` and `promotion_test` strings.
7. **Exclude anything the source package itself flags as unsafe to probe** —
   e.g. SEAT's package had 3 DID candidates explicitly marked
   `automatic_execution_authorized: false` (unresolved 29-bit encoding). Grep
   the incoming package for that kind of flag before converting; don't rely
   on the schema to catch it, it won't.
8. **Platform-scoped routes need a real `vds_pattern`-bearing `platforms[]`
   entry on the brand in the *trusted* `uds-map.json`** to ever actually
   fire (`platform_for_vin`). If the brand has none yet (SEAT: zero, as of
   this writing), platform-scoped candidates are correctly inert until a
   real VIN confirms the pattern — that's expected, not a bug. Tag those
   routes with their real platform key anyway (don't fudge them to
   `"unknown"` just to make them fire) — see the test
   `seat_deep_research_delta_serves_make_wide_candidates_with_dids` for how
   to assert both halves of this.
9. **Decode formulas remain untrusted hypotheses.** `candidate_dids` accepts
   the legacy hex string or a detailed object with `did`, optional `semantic`,
   `decode`, `validation`, `automatic_execution_authorized` and
   `support_status`. The planner may retain this metadata in its evidence
   purpose, but it never enters `known_did` or the trusted decode path
   (`candidates_do_not_enter_the_trusted_decode_path`). A formula becomes a
   trusted map decode only after physical validation and review.
10. **One address per route.** Source shorthand such as
    `730/748 -> 79A/7B2` must become two candidate routes. Runtime validation
    rejects non-hexadecimal addresses and DIDs so malformed records cannot
    silently vanish from the plan.

## After ingesting

- `cargo test --lib discovery::research` (fast, self-contained) then
  `cargo test --lib` (full crate) from `apps/desktop/src-tauri`.
- Add one test asserting the new brand's candidates actually surface from
  `routes_for_context` — a silent zero-route result is the most likely
  failure mode (rule 1) and nothing else will catch it.
- No `packages/uds-map` (TypeScript/vitest) changes are needed — research
  packs are Rust-only, not part of the `@scainner/uds-map` npm package or its
  lint/coverage scripts.
