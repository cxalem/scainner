# Research: code-scanner UI at scale

Trigger: Alejandro's own car threw 86 fault codes from one battery
issue (every electrical system throwing errors from a single root
cause). Today's `Diagnose` view shows codes as a flat wrapped row of
colored badges, grouped only by status (stored/pending/permanent) — fine
at 2-3 codes, unusable at 86. He wants a genuinely good code-scanner UI,
better than what's commercially available, not just a fix for badge
wrapping.

## Codebase grounding

`src/views/Diagnose.tsx` (post-Effect-migration split) plus
`src/views/diagnose/{CodeBadge,CodeList,DtcDetailModal,AiReportCard,
FreezeFrame}.tsx`. Offline DTC knowledge in `src/lib/dtc.ts`:
`decodeDtc()` does structural decode for any syntactically valid code
(system, subsystem, origin) — this taxonomy already exists and is free
to use for grouping. `DTC_LIBRARY` is a curated ~30-code set with
meaning/causes/symptoms/severity (low/medium/high). `DtcDetailModal`
already covers the full per-code deep-dive (meaning, severity, anatomy,
occurrence timeline, freeze frame, causes/symptoms, AI button) — nothing
in this research suggests rebuilding it, only changing what feeds it.

## What real tools do

**Consumer apps** (Torque Pro, Car Scanner ELM OBD2, BlueDriver, FIXD,
OBDLink, INNOVA, ANCEL, Carly): thin on confirmed screen mechanics, but
what's documented is a flat list navigating to a detail screen per code,
no confirmed severity color coding, no confirmed system/module grouping
except Carly's claimed (unverified visually) module organization. Real,
sourced complaints: Torque "looks like it was designed in 2012"; Carly
"slow, laggy, unfinished" despite being the premium option; FIXD
"confusing," sometimes fails to clear resolved warnings; ANCEL/Autel
consumer tier "janky," loses saved vehicle data between sessions;
BlueDriver caps code history at 4 saved scans. A reviewer's direct
complaint about Car Scanner/Torque: you still don't know if a code means
"a 40 euro sensor or a 900 euro catalytic converter" — a gap this app's
own curated `dtc.ts` severity/causes library already closes, ahead of
most competitors.

**Shop-grade tools** (Autel MaxiSys, Launch X431, Snap-on): more mature.
Autel's all-systems scan highlights each module's DTC count in red as it
completes — a per-module list with counts, not a flat combined table.
Stored codes are prioritized by emission severity; pending codes tracked
separately, self-clear over 40-80 warm-up cycles if the fault doesn't
recur; freeze frame kept for the highest-priority code when several are
present. Launch X431 offers a literal topology map of every control
module, color-coded red/green/grey — the most visually distinctive
"many codes at a glance" pattern found anywhere. Snap-on's flow (list in,
one code opens a multi-tab detail hub) is structurally close to what
this app's `DtcDetailModal` already does. None of the three do real
cross-code root-cause clustering in the shop-floor UI.

## Root-cause clustering: the actual finding worth acting on

Two independent lines of evidence converge on a real, confirmed gap:

1. **Automotive industry has solved this at the research level, never
   shipped it.** GM Global Technology Operations holds multiple patents
   (US 2012/0303205A1, US 11,151,808, others) explicitly on "many DTCs,
   one root cause" — fleet-level statistical mining and Bayesian
   classifiers to disambiguate overlapping fault symptoms. This lives in
   OEM warranty-data-science backends, never in a tool a shop or owner
   touches.
2. **Alert-monitoring software has shipped a mature, working version of
   the structurally identical problem.** PagerDuty's Intelligent Alert
   Grouping (time-window + ML text similarity, retrains from technician
   merge/un-merge behavior, discloses which method fired via an
   "Alert grouping details" panel) and Datadog's Intelligent Correlation
   (topology + shared tags, waterfall timeline of failure propagation)
   and Sentry's fingerprint-based issue grouping (with an expandable
   "Event Grouping Information" panel showing exactly why events were
   merged) all solve "many signals, one cause" honestly — never
   asserting causation, always showing the reasoning. PagerDuty's own
   docs consistently say "similarity," not "root cause."

The consistently confirmed real-world fact across forums, patent
background sections, and repair-shop sources: low system voltage and bad
ground connections are the single most commonly cited "one cause, many
codes" scenario in the field — directly matching Alejandro's own
incident. No tool researched flags this explicitly.

## Recommendation

**List shape**: a flat, filterable, groupable list with a severity/status
indicator per row — closer to VS Code's Problems panel or Sentry's
Issues list than a data table (DTCs have one real comparison axis,
severity, so a table's column-comparison strength doesn't apply) or a
card grid (card re-orientation cost breaks down exactly at high counts,
per Nielsen Norman Group's own documented guidance).

**Scaling from 2 to 86 without two designs**: default grouping by system
(Powertrain/Chassis/Body/Network, free from `decodeDtc()`, works even
for codes outside the curated library), with a group collapsing to
header+count only once its size crosses a threshold. At 2-3 codes this
renders as today's effective flat list; at 86 it becomes a handful of
scannable group headers, mirroring Autel's per-module count highlighting.

**Severity/status encoding**: keep stored/pending/permanent as the
top-level fact (an OBD2-defined distinction every professional tool
preserves). Layer severity (already computed in `dtc.ts`) as the primary
visual signal within each group — color plus text label together, never
color alone. Unknown codes (not in the curated library) get an honest
neutral state, matching the existing "not in the built-in library" copy
already in `DtcDetailModal` — no guessed severity.

**Root-cause clustering, the genuinely new piece**: a lightweight,
optional, honest layer above the grouped list, not a hidden
reclassification. When a scan's `voltage` was low, or a cluster of
network/communication codes (U-codes, P0562 "system voltage low")
appears alongside unrelated system codes, show a plain note above the
list: "N of these M codes are commonly a side effect of low battery
voltage, not independent faults." Every code still appears in its normal
group; the note is a triage hint, never a filter. Styled after Sentry's
"why grouped" transparency and PagerDuty's "similarity, not causation"
framing, and directly matching this app's own "Honest absence" design
principle (state what's known and why, never assert false certainty).

**List-to-detail interaction**: unchanged. `DtcDetailModal` already does
the full deep-dive; the only change is what feeds it (the new grouped
list's row click, same `onSelect` pattern `CodeBadge` already uses).

## What was not investigated

No live app installs or screenshots (doc/marketing/forum text only).
First-hand app-review threads on r/MechanicAdvice or similar (search
kept surfacing e-commerce listings; the closest real evidence was
car-model forums like BimmerFest/DuramaxForum describing the
battery-cascade scenario itself, not app UX complaints). No live testing
of Scainner's current UI in a running session (external research plus
static code reading only). Matco/OTC/Hickok pro tools not covered
(Snap-on/Launch/Autel plus the observability comparison judged higher
value with the available budget).

## Top recommendation

System-grouped, severity-colored flat list, collapsing groups only past
a size threshold so the same design handles 2 and 86 codes. Keep
`DtcDetailModal` untouched as the drill-down target. Add one honest,
inspectable clustering hint driven by scan voltage and system-code
correlation, styled after Sentry/PagerDuty's transparency rather than
any car tool's silence on the subject — this is the one piece with no
real prior art in car diagnostics at all, and it's aimed directly at
Alejandro's actual incident rather than just tidying the badge wall.

## Next step

This is research-stage output. Needs a real planning pass (concrete
component boundaries, the clustering heuristic's exact rule, whether a
threshold/library like framer-motion is needed for any transition
between grouped/ungrouped states) before build — not scoped here.
Sequenced behind the architectural queue (Effect migration, monorepo)
per BACKLOG.md's priority order, since this stream touches
`Diagnose.tsx` and its split components, which both of those also touch.
