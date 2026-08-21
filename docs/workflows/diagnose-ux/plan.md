# Plan: code-scanner list redesign

Builds on `research.md` (same folder). Research's top recommendation:
system-grouped, severity-colored, collapsing list; keep `DtcDetailModal`
untouched; add one honest low-voltage clustering hint. This plan makes
those concrete: exact grouping rule, exact clustering rule, exact
component boundary, matching the codebase as it exists post-Effect-
migration (`packages/core`'s Schema types, `apps/desktop/src/lib/dtc.ts`'s
`decodeDtc`/`DTC_LIBRARY`).

## The two-axis question, resolved

Research flagged status (stored/pending/permanent) as "the top-level
fact" every professional tool preserves, and system (Powertrain/Chassis/
Body/Network) as the scaling mechanism. Read together, not in tension:
**status stays the outer grouping** (matches the OBD2 spec's own
distinction, matches today's UI), **system groups within each status**
(the new part, this is what actually scales to 86). A status section
with zero codes doesn't render (already true today). A status section
with a handful of codes shows them ungrouped-looking (system headers
present but every group auto-expanded, effectively today's flat list).
A status section with dozens shows collapsed system headers with counts.

## Concrete grouping and collapse rule

- Group codes within a status by `decodeDtc(code).system` (Powertrain/
  Chassis/Body/Network — already computed, zero new taxonomy). A code
  that fails `decodeDtc` (malformed) gets its own "Other" group rather
  than being dropped — matches "Honest absence," never silently hide a
  code.
- Within a group, sort by severity: high, medium, low, then unknown
  (not in `DTC_LIBRARY`) last. Surfaces the worst thing in a group
  first, matching Autel's emission-severity-first pattern from research.
- **Collapse threshold: a group auto-expands if it has 6 or fewer
  codes; past that, it renders as a header (system name + count +
  worst severity present) collapsed by default, click to expand.** 6 is
  a real, statable number, not "some": it's roughly what fits in a
  card's height without scrolling before the collapse becomes worth it.
  At 2-3 total codes (today's common case) this never triggers, so the
  visual result is unchanged from today. At 86, most groups collapse to
  one line each.

## Concrete clustering rule (the genuinely new piece)

Deliberately simple and defensible for v1, not full statistical
inference, matching research's own "honest, inspectable, not hidden
reclassification" framing:

- **Trigger**: `scan.voltage != null && scan.voltage < 11.8` (reuses the
  existing Wave 2 alert threshold already established elsewhere in this
  app for "voltage low while running" — not a new number invented for
  this) **OR** the code set contains `P0562` (already curated in
  `dtc.ts` as "System voltage low," severity high) **OR** 2 or more
  `U`-prefixed (network/communication) codes are present alongside
  codes from other systems.
- **Affected set**: every `U`-code present, plus `P0562`/`P0563` if
  present. Not a guess at every code that *might* be voltage-related —
  only the ones with a real, direct mechanism (network codes are the
  single most consistently cited real-world "low voltage causes this"
  pattern per research; stretching the heuristic to guess at, say, a
  misfire code being voltage-related would be exactly the false-
  certainty this design principle exists to avoid).
- **Copy**: "N of these M codes are commonly a side effect of low
  battery voltage or a weak charging system, not independent faults."
  Rendered as a plain note above the grouped list (not a filter, not a
  removal) with the affected codes visually marked (a small icon or
  note inline, not a separate section) so a user can still see and
  click every one of them normally.
- This is a pure function of the scan data, computed client-side, no
  new backend command needed.

## Component boundary

`CodeList.tsx` is fully superseded (its only call sites are the three
`Latest Scan` status rows being replaced) — delete it, don't leave it
dormant, matching this repo's own precedent of removing genuinely
superseded code rather than carrying it. `CodeBadge.tsx` stays: it's
also used standalone in the compact Scan History rows, a different,
intentionally terse context that doesn't need grouping.

New files, all under `apps/desktop/src/`:
- `lib/dtc-grouping.ts` — pure functions, no React: `groupBySystem(codes:
  string[]): { system: string; codes: string[] }[]` (sorted by severity
  within each group per the rule above) and `detectVoltageCluster(scan:
  { stored: string[]; pending: string[]; permanent: string[]; voltage:
  number | null | undefined }): { affected: string[]; note: string } |
  null`. Colocated `dtc-grouping.test.ts` — this is exactly rule 11(c)'s
  highest-priority pure-logic-function case, and the natural way to
  prove the 86-code scenario works without needing a live 86-code mock
  scan: a synthetic fixture in the test, not a change to `mock.ts`'s
  actual demo story (out of scope, that's BACKLOG.md stream E's demo-
  scenario-switcher item, not this one).
- `views/diagnose/CodeGroupRow.tsx` — one system group: header (system
  name, count, worst severity) when collapsed; expanded list of code
  rows when open or under threshold. Each code row: severity dot +
  code + short title (from `DTC_LIBRARY` if known, "not in library"
  honest-absence text if not) + click target calling the existing
  `onSelect(code)` prop straight into `DtcDetailModal`, same pattern
  `CodeBadge` already uses.
- `views/diagnose/VoltageClusterNote.tsx` — the one clustering banner,
  renders nothing if `detectVoltageCluster` returns null.
- `views/diagnose/CodeStatusSection.tsx` — one status (Stored/Pending/
  Permanent): renders nothing if empty, otherwise the status label plus
  its `CodeGroupRow`s.

`Diagnose.tsx` changes: replace the three `<CodeList .../>` calls with
one `<VoltageClusterNote scan={scan} />` plus three `<CodeStatusSection
status="stored" codes={scan.stored} onSelect={setDetailCode} />` (etc).
`DtcDetailModal.tsx`, `FreezeFrame.tsx`, `AiReportCard.tsx`,
`WriteHistory.tsx` — untouched, per research's own explicit scope.

## Testing, per the current policy (rule 11 in patterns/engineering.md)

- `dtc-grouping.test.ts`: `groupBySystem` correctness (a mixed-system
  code set groups right, sorts by severity within a group, a malformed
  code lands in "Other" not dropped); `detectVoltageCluster`'s three
  trigger conditions each tested independently, plus a synthetic
  86-code fixture (mixed systems, a low-voltage scan) proving the whole
  pipeline handles that scale without special-casing — this is the
  actual proof the redesign solves Alejandro's real incident, not a
  live screenshot.
- Live/visual check: warranted once, narrowly, for the collapse/expand
  interaction and the severity color rendering specifically (genuinely
  visual, per rule 1's exception) — not a full walkthrough of every
  status/count combination, the logic tests already cover those.

## What this does NOT do

- No change to `DtcDetailModal`'s own content or the AI report flow.
- No new backend command — everything here is a client-side
  transformation of data already fetched.
- No animation/transition work for the expand/collapse interaction
  (that's the separate animation-system stream, sequenced after this
  one per BACKLOG.md's priority order — ship the mechanism plain first,
  animate it once that stream lands rather than build motion twice).
- No table. Confirmed directly with Alejandro this session that the
  research's list-not-table recommendation is understood and the right
  call; not re-litigated here.
