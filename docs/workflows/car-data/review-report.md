# Review report: car-data, stage 1 (WMI table to JSON + first test infra)

Reviewer: Claude (Fable 5), 2026-08-21. Branch `ws/car-data` at 51ed08a
plus this review's fix commit, reviewed in the worktree
`/Users/cxalem/projects/scainner-car-data` against `main...ws/car-data`
(2 commits, 8 files, +820/-107). Per the 2026-08-21 reviewer policy the
verification here is the test suite plus static checks, no live pass:
nothing in this diff is visual, and every changed behavior is covered by
a test or by a check I ran directly.

## Verdict: ship, with the two small fixes made in this review

The migration is clean and the builder's claims all reproduced under
independent re-verification. The data move lost nothing, changed
nothing it should not have, and the six additions match the audit
exactly, confidence labels included, with no inflation. The new Vitest
setup is minimal, sensible, and a good template for future streams. I
found one real test gap (malformed WMI keys pass validation silently
and become unreachable) and one inaccurate doc comment, both fixed
here; everything else holds.

## Scope check

Diff touches: `apps/desktop/src/data/wmi.json` (new),
`apps/desktop/src/lib/brand.ts` (inline table removed, parseWmiTable
added), `apps/desktop/src/lib/brand.test.ts` (new),
`apps/desktop/vitest.config.ts` (new), the two `package.json` files,
`turbo.json`, and the lockfile. Nothing else. Zero Rust files touched:
`git diff main...HEAD` contains no `.rs` file and nothing under
`src-tauri`, so cargo is unaffected by construction (this is the
verification method the situation calls for; a cargo check run would
re-prove code this diff never touched). No emblem/GLB pipeline changes,
no model/trim scaffolding, matching the plan's "does NOT do" list. No
scope creep found.

## Independent verification (mine, not the builder's)

**The 13/13 test claim.** True, but with a trap worth recording:
`pnpm test` at the repo root returned success from a turbo cache hit,
replaying the builder's logs without executing anything. I forced a
real run with `pnpm exec vitest run` inside `apps/desktop`: 13/13 pass
fresh, in about 100ms. After my fixes: still 13/13 (one test grew
extra assertions rather than adding a new case). `npx tsc --noEmit` is
clean before and after. Future reviewers: a root `pnpm test` that says
`FULL TURBO` has verified nothing, force past the cache.

**The migration lost nothing.** Verified mechanically, not by count. I
extracted every entry from `main:apps/desktop/src/lib/brand.ts` with a
script and diffed key/value pairs against `wmi.json`: old table 53
entries, new table 59, dropped none, key/name values changed in zero
carried-over entries, added exactly {SJK, SHS, LVY, 7G2, 7SA, WA1},
the six the plan named. The confidence distribution (45 high, 6
medium-high, 8 medium) also reconciles arithmetically with the audit's
own summary: 39 high of the audited 55, minus the three removed rows
(none of which were high), plus JS2 and the five high-confidence
additions gives exactly 45; the 12 audited medium/medium-high plus LB3
and SJK give exactly 14. Nothing "low" is in the table, matching the
header comment's claim.

**Spot-check of confidence labels and source notes against the audit
(15+ entries across tiers).** No inflation found; if anything the
builder rounded down honestly on the split-confidence rows:

- VR7 medium, VF7 high, VR1/VR3 medium-high: match the audit rows
  verbatim.
- W0L high: the audit graded "High (Opel itself) / Medium (the
  Vauxhall-sharing claim)". The JSON takes high but scopes the entry
  to Opel only and explicitly says the Vauxhall claim is "not relied
  on here". That is the correct reading, not inflation.
- VSS medium-high with the Cupra caveat spelled out: matches the
  audit's split grade.
- SJN/VSK medium, KNE/U5Y medium, XP7 medium: match, and each source
  note carries the audit's actual doubt (VSK "possibly a stale legacy
  code", U5Y "technically incomplete") rather than sanding it off.
- LB3 medium with the Wikibooks contradiction and the deliberate L6T
  exclusion both preserved: faithful to the audit's most important
  unresolved finding. Note the audit flagged LB3 for a human decision;
  keeping it at medium with the conflict documented is the status quo
  from main, not a new claim, and is reasonable pending Alejandro's
  call.
- New codes: SJK medium-high (audit: medium-high), SHS/LVY/7G2/7SA/WA1
  high (audit: "High (NHTSA-confirmed)" for all five). All match, and
  each `source` says it was added 2026-08-21 from the audit's list, so
  provenance is traceable per entry.
- The audit's weaker candidates (WME, ZFB, LNN, VS7/VS8/VS5, VGA) were
  correctly not added; the plan asked for the strongest candidates
  only and named exactly the six that went in.

**brandFromVin is genuinely unchanged.** Same signature
(`vin: string | null | undefined` to `BrandInfo | null`), same body
(`slice(0,3).toUpperCase()` lookup, `?? null`), verified in the diff
line by line. The tests confirm null on no-match, null on
null/undefined/short/empty, case-insensitivity, and no throw. The only
observable change to consumers is that `BrandInfo` gained two fields,
which is additive; tsc is clean and both consumers (DiscoveryFlow.tsx,
VehicleScene.tsx) only read `key`/`name`.

**parseWmiTable break attempts (mine, beyond the shipped tests).** I
wrote a temporary probe test (deleted before commit) throwing exotic
input at it: `Date`, a function, a `Map`, case-colliding keys, extra
fields, empty-string source, malformed keys. It never threw on
anything. Findings from the probe are below.

**The packages/ui quote is real.** The commit message's placement
rationale quotes the monorepo plan as saying packages/ui is "NOT
assumed cross-platform-shareable... until proven otherwise". I found
the exact passage in `docs/workflows/monorepo/plan.md`; the quote is
verbatim and the characterization of packages/data ("shared by both
apps") is also accurate. No fabricated-quote issue in this stream.

## Findings

1. **Fixed here (test gap, the only real defect): malformed WMI keys
   pass validation silently and become unreachable.** parseWmiTable
   validates entry values but not keys: my probe showed `"VR7 "`
   (trailing space), `"AB"`, `"ABCD"`, and `""` all pass and land in
   the table, where the 3-character VIN lookup can never match them. A
   future hand-edit typo in wmi.json would silently kill that brand's
   badge, and the shipped "no silent drops" test would not notice
   (the entry parses fine, it is just dead). Fix applied: the
   real-data test now asserts every wmi.json key matches
   `/^[A-Z0-9]{3}$/`, which catches the typo class at test time and
   also forecloses case-collision overwrites in the real data. I chose
   a test-side guard over a runtime key check on purpose: at runtime an
   unreachable entry already behaves identically to a dropped one, so
   the only value is detection, and detection belongs in CI. 13/13
   still pass.

2. **Fixed here (doc accuracy): the brand.ts header overstated what
   "high" means.** It said high = "NHTSA-confirmed directly (or an
   obvious sibling of one)", but VF7, UU1, and TMB are high purely on
   convergent secondary sources (the audit graded them high because
   three-plus independent lineages agree; NHTSA cannot cover non-US
   brands). In a stream whose whole point is honest confidence
   labeling, the gloss should not promise more than the data holds.
   Comment rewritten to match the audit's actual grading logic.

3. **Noted, not fixed (judgment call, adequately explained): placement
   in apps/desktop/src/data rather than packages/data.** Both plans
   name packages/data as the eventual destination, and the packages/
   scaffolding now exists (packages/core is real), so the letter of
   the car-data plan's "once that scaffolding exists" arguably points
   at packages/data today. The builder deviated with stated reasoning:
   apps/mobile is an empty Expo shell (verified: App.tsx and index.ts
   only, zero car code), so there is no second consumer to prove a
   shared package against, and the same plan's own packages/ui caution
   supports not abstracting ahead of proof. I find the reasoning
   sound and the cost of being wrong near zero (one JSON file plus one
   function, a directory move later), and the rationale lives in the
   commit message per engineering pattern 8. But it is a real
   deviation from the plans' stated destination, so it goes on record
   here rather than silently passing.

4. **Noted, minor: parseWmiTable accepts an empty-string `source`.**
   key and name require length > 0, source only requires string type.
   Inconsistent but harmless (source is metadata, not behavior), and
   the real-data test asserts every actual entry has a string source.
   Not worth churn now; tighten if the validator ever gets promoted to
   packages/data.

5. **Noted, minor: case-colliding raw keys last-wins silently.** If
   wmi.json ever contained both "vr7" and "VR7", parseWmiTable keeps
   whichever Object.entries yields last, and the original
   no-silent-drops test's Set-based dedup would mask the loss. The new
   uppercase-key assertion from finding 1 forecloses this for the real
   data (lowercase keys now fail the test). A JSON file with two
   identical duplicate keys is undetectable in JS at all (JSON.parse
   last-wins before user code runs); only lint tooling could catch
   that, not worth adding today.

## Precedent assessment: does this set up the test-first policy well?

Mostly yes, and I would tell future streams to copy it.

Good precedent, worth copying:

- Colocated `*.test.ts` next to the unit, exactly as engineering rule
  11 specifies, starting with a rule-11(c) pure-logic function that
  needs no running app.
- A separate `vitest.config.ts` that does not contaminate the
  Tauri-specific `vite.config.ts`, with the "@" alias verified
  identical to both tsconfig paths and the vite config (I checked all
  three).
- The turbo wiring mirrors the existing `typecheck` task, so
  `pnpm test` works repo-wide and skips packages without a test
  script. Adding a test script to packages/core later is one line.
- The tests assert behavior contracts (null-not-throw, case
  handling, drop-not-crash) plus one test that walks the real
  production data end to end. That real-data test is the best idea in
  the file: it turns the JSON dataset itself into a tested artifact,
  and future data-carrying streams should copy the pattern.

Gaps future streams should know about, none blocking:

- **The turbo cache trap (see verification above).** A green
  `pnpm test` at root can be a log replay. Reviewer instructions or
  the reviewer role doc should say "force past the cache"; I am
  flagging it here so the next reviewer does not get fooled. The cache
  invalidates correctly on input changes (my edits invalidated it), so
  builders are safe; it is specifically the re-verify-someone-else's-
  claim workflow that must bypass it.
- `environment: "node"` is right for pure logic but any future
  component test will need jsdom/happy-dom per-file or a config
  change. Fine to defer, rule 11 explicitly says do not build the
  component harness speculatively.
- Rule 11's priority (a), mock.ts parity, and (b), Schema decode
  boundaries, are still untested. This stream's scope did not include
  them, but now that the infra exists there is no infrastructure
  excuse left; the next stream that touches mock.ts or the Effect
  schemas should add those tests rather than pointing at this stream
  as if data-table tests were the whole policy.
- A validator test gap of the shape found in finding 1 (values checked,
  keys trusted) is an easy class to repeat. When copying the
  real-data-walk pattern, also assert the shape of the KEYS.

## Questions for the Codex cross-exam

1. Should wmi.json live in packages/data now that packages/ exists
   (finding 3)? The reviewer accepts the builder's no-second-consumer
   reasoning, but a second opinion on plan-letter vs plan-spirit is
   exactly what cross-exam is for.
2. LB3/geely remains in the table at medium despite the audit flagging
   it for a human decision. Should the cross-exam push it up to
   Alejandro's gate, or is medium-with-documented-conflict the right
   resting state until a better source appears?
3. Is a test-time-only guard for malformed keys enough (finding 1), or
   should parseWmiTable also reject bad keys at runtime for
   defense-in-depth once this is a shared package?

## Fix commit

One commit on top of the builder's two: the key-format assertion in
brand.test.ts and the corrected confidence gloss in brand.ts, plus this
report. Re-verified after the fixes: 13/13 vitest pass (fresh run, not
cached), tsc clean.
