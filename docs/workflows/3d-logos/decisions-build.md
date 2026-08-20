# Decision log: builder, 3d-logos

Each block: what, options considered, why, risk.

## Sequencing corrected mid-flight to match the plan's gate

What: my first draft of `emblems.tsx` wrote all four new brand
components (Renault, Mercedes, Volvo, Opel) in one pass, ahead of the
plan's step ordering. Caught before committing anything, and rewritten
to match: step 1 commit has only the extraction (Citroen, Nameplate,
registry with just `citroen`) plus the dev VIN override; step 2 adds
Renault alone and is verified in the running app before step 3 starts.
Options: (a) keep the all-at-once draft since the code was already
correct, (b) discard and rebuild file-by-file per the plan's gate.
Why: (b). The plan's whole point with the Renault gate is to prove the
approach (hand-authored Shape outlines read at card size) before
sinking effort into three more brands built the same way. Committing
all four at once would have made the gate cosmetic — if Renault had
failed to read, the "stop and report" fallback would already have
Mercedes/Volvo/Opel sitting in the diff. Rebuilding cost a few minutes
and kept the gate meaningful.
Risk: none material; the final diff is identical in content to what
the all-at-once draft would have produced, just split across five
commits in the plan's order.

## curveSegments for ring-based emblems: new EXTRUDE_SETTINGS_CURVED

What: added a second settings constant
(`EXTRUDE_SETTINGS_CURVED = { ...EXTRUDE_SETTINGS, curveSegments: 24 }`)
used by Mercedes, Volvo, and Opel (all built from `THREE.Shape.absarc`
rings), while Citroen and Renault keep the original `EXTRUDE_SETTINGS`
(straight-line outlines, where curveSegments is irrelevant).
Options: (a) bump curveSegments on the single shared EXTRUDE_SETTINGS
object (affects Citroen/Renault too, harmlessly, since neither has
curves), (b) a second settings constant scoped to curved brands.
Why: (b). The plan explicitly calls out "keep curveSegments around 24"
for ring shapes (patterns/3d.md rule 8, plan's shared-constraints
block) as opposed to the extrude defaults used by the chevron/rhombus
brands. A separate named constant keeps the intent legible (this
setting exists because of arcs) rather than silently changing a value
that happens to not matter for the other two brands today but might
if a future brand's Citroen-style shape grows a curve.
Risk: none; purely a code-organization choice, not a rendering
difference from option (a) for the current brand set.

## Mercedes / Opel: extruding ring + inner shapes as one shape array

What: for Mercedes (ring + 3 spokes) and Opel (ring + Blitz band), both
the ring shape (with its inner-circle hole) and the inner mark shape(s)
are passed to a single `THREE.ExtrudeGeometry(shapes, ...)` call and
then `geometry.center()`'d together, producing one mesh with one
material, matching the Citroen double-chevron pattern (two shapes, one
extrude call).
Options: (a) one geometry per shape, multiple meshes, (b) one extrude
call across all shapes for a brand.
Why: (b). Matches the existing Citroen worked example exactly (plan's
explicit instruction to follow that recipe), keeps one geometry/one
material/one dispose per brand component (simpler cleanup, matches
patterns/3d.md rule 9), and avoids z-fighting or seam artifacts between
separately-extruded pieces sharing the same depth.
Risk: none observed; screenshots for both brands show clean, unified
gemetry with no visible seams between ring and inner mark.

## Volvo: build the arrow axis-aligned, rotate the whole geometry

What: VolvoEmblem's arrow shape is authored pointing along +x (shaft
starting at the ring's outer edge, arrowhead further out), then
`geometry.rotateZ(Math.PI / 4)` rotates the combined ring+arrow
geometry 45 degrees before centering.
Options: (a) compute arrow point coordinates pre-rotated (sin/cos on
every vertex by hand), (b) build axis-aligned then rotate the geometry.
Why: (b). Far less error-prone than hand-deriving rotated coordinates,
and the ring's circular symmetry means rotating it is free (rotating a
circle has no visible effect, so the combined ring+arrow geometry can
be rotated as one piece without distorting the ring). This is my own
implementation choice, not something the plan specified — the plan's
Volvo spec gives dimensions and angles for the finished shape, not a
construction strategy.
Risk: none; verified visually, the arrow points upper-right as
specified.

## Volvo second verification screenshot: spaced further apart than other brands

What: the plan expects "two screenshots at different rotation angles
(spaced a few seconds)" per brand. For Volvo, the first wait-8s shot
landed on a clean three-quarter view but the next few 6-10s waits
landed on near-edge-on profile views of the ring (an unlucky rotation
phase for this specific asymmetric mark, since the connected
auto-rotate speed is slow, ~39s/turn per patterns/3d.md rule 4). I
waited longer (accumulated ~34s from the first shot) to reach a second
angle that still reads clearly as ring+arrow, rather than accepting an
edge-on shot that proves nothing.
Options: (a) accept a lucky-but-uninformative edge-on angle to stay
within the plan's "a few seconds" spacing, (b) wait longer for a second
angle that actually demonstrates recognizability.
Why: (b). The acceptance criterion is "recognizable... at 2+ rotation
angles," not "2 screenshots regardless of legibility." An edge-on shot
of a thin ring is not evidence of anything.
Risk: none; this is a verification-methodology note, not a code change.

## Correction: Volvo entry cited a plan quote that doesn't exist

What: the Volvo rotation entry above originally justified the
axis-aligned-then-rotate approach as "exactly as the plan suggested"
and quoted a sentence attributed to plan.md. Stage 4 review
(review-report.md, finding 2) checked plan.md and found no such
sentence: the plan's Volvo spec states dimensions and angles for the
finished shape, never a construction strategy or a rotation
recommendation. The quote was fabricated.
Options: (a) leave the entry as-is since the underlying engineering
decision was sound, (b) correct the entry to own the reasoning instead
of misattributing it to the plan.
Why: (b). The decision itself needed no defense — it is correct on its
own merits, as the corrected entry above now states. But a decision
log that invents a source citation is a defect regardless of whether
the decision was right, because it undermines trust in every other
entry's claims. Fixed by rewriting the Volvo entry to state the actual
reasoning (implementation-level convenience, not a plan requirement)
with no quotation.
Risk: none; this is a documentation-only correction, no code changed.

## No deviations from the plan's file boundary or geometry specs

All four brand components use the dimensions given in the plan
verbatim (Renault outer/inner rhombus, Mercedes ring + spoke angles,
Volvo ring + arrow dimensions, Opel ring + Blitz dimensions) with no
tuning needed — every brand read as recognizable on the first render,
so no iteration loop was required beyond the Volvo screenshot-timing
issue above. Diff touches only `src/components/emblems.tsx` (new) and
the emblem section of `src/components/VehicleScene.tsx`, confirmed via
`git diff --stat main` before the final commit.

## Post-review fixes (stage 4, commits 4020361, f9ecf2d, and this log)

What: stage 4 review (review-report.md) verdict was fix-then-ship with
three required changes, applied here:

1. Opel Blitz read as a soft S-wave, not a bolt, at card size (finding
   1, gates ship). Fixed by steepening the diagonal step: `stepY` 0.16
   -> 0.28, `armLen` `innerR * 0.55` -> `innerR * 0.62`, per the
   report's proposed-fix section. Fixed on the first iteration —
   re-verified against `?vin=W0LAAAAAAAAAAAAAA` at two rotation
   angles, both show a sharp diagonal stroke, not a wave. No second
   iteration needed.
2. This decision log's Volvo entry misattributed a fabricated plan
   quote (finding 2). Corrected above.
3. The Renault band's rendered thickness (about 0.106) doesn't match
   the 0.14 offset constant, because the offset is applied along the
   rhombus axes rather than perpendicular to its edge (finding 3). The
   render reads fine and the band is genuinely constant width, so per
   the review only the code comment was corrected to state the true
   thickness; the geometry is unchanged.

Options: none — these were prescribed fixes from an explicit review
verdict, not open decisions.
Why: applying reviewer-identified, scoped fixes rather than re-opening
already-reviewed areas keeps the review's gate meaningful and avoids
re-litigating decisions (like the Mercedes/Opel shared-extrude
pattern, or the Renault band's constant-width property) that review
already validated as correct.
Risk: none; each fix is scoped to exactly what the review specified,
verified independently (tsc + fresh screenshots for the one geometry
change).

## Addendum: STL emblems replace hand-authored/traced shapes (2026-08-20)

Source: Alejandro supplied two STL batches directly
(Brand_Emblems_STL_Proper_Batch_02: Audi, BMW, Mercedes-Benz, Peugeot,
Renault, Skoda, Toyota, Volkswagen; Batch_03: Dacia, Hyundai, Kia, Opel,
plus a README). This is not agent-researched provenance — the README
states "Kia and Opel are built from current vector logo artwork; Hyundai
is vector-traced from a high-resolution official-symbol render; Dacia is
a faithful geometric reconstruction of the current Dacia Link emblem," a
claim taken at face value since it can't be independently re-verified
from inside this repo, the same honesty standard as any other unverified
external claim in these logs.

What changed: RenaultEmblem, MercedesEmblem, and OpelEmblem (the
hand-authored / SVG-traced shapes built earlier this stream) are removed,
replaced by real STL geometry via a new generic StlEmblem component.
Audi, BMW, Peugeot, Skoda, Toyota, Volkswagen, Dacia, Hyundai, and Kia go
from NameplateEmblem fallback to real modeled geometry for the first
time. Citroen and Volvo are unchanged (no STL supplied for either yet).

Decision: auto-detect the depth axis from each file's own bounding box
(thinnest axis wins) rather than a fixed per-batch rotation constant.
The batch mixes ASCII and binary STL headers, meaning at least two
different export tools produced these files with no shared up-axis
convention to rely on. A 90-degree axis swap is a proper rotation, so
this cannot mirror any artwork, only pick which of two faces ends up
toward the camera — checked per brand in the running app, not assumed.

Decision: toCreasedNormals runs unconditionally on every STL load, not
conditionally on whether a given file looked faceted when tested. STL is
a facet soup by format regardless of source tool (patterns/3d.md rule 1);
skipping this because today's 12 files happened to load looking fine
would be exactly the kind of latent bug a future re-export could trigger
silently.

Verified: all 12 brands checked live in the browser via the dev ?vin=
override (not just that they loaded without error) — correct orientation,
smooth shading, legible marks. Peugeot's lion and BMW's quartered roundel
in particular were expected to be the hard cases (this stream's own
research.md called Peugeot's mark "figurative... nameplate" and BMW's
"tiny wordmark likely unreadable") and both read fine as real sculpted
geometry, which flat hand-authored shapes could not have managed for
either.

Also bumped: overall emblem size across every brand (StlEmblem default
target width, plus proportional bumps to Citroen and Volvo's hand-built
geometry) at Alejandro's request, verified against patterns/3d.md rule 7's
card-cropping constraint in both the connect-flow card and the dashboard
Overview card before shipping.

Not done here: color/texture. STL carries no UV or material data, so
"texture" is out of reach without hand-authoring UVs per brand, real
effort for real payoff on maybe one or two marks (BMW's quartered
roundel is the one that would benefit most, since its design leans on
color contrast the others don't). Left as monochrome chrome per
Alejandro's own stated fallback ("if not, use them as they are would be
nice") — flagged here as a named follow-up, not silently dropped.

Verified the production build too, not just dev: `vite build` bundles all
12 STL files into the packaged output correctly (confirmed files land in
dist/emblems/stl/, no network fetch needed at runtime, consistent with
the ?vin= dev-override production trace Codex already did for this
stream). Total STL payload is 5.1MB, Peugeot alone is 2.4MB of that -
worth naming honestly rather than leaving it a silent bundle-size
increase. Not treated as a blocker for a desktop app, but a real
follow-up if bundle size becomes a concern: STL decimation/simplification
per file, or converting to a more compact format (glTF/Draco) at build
time, either done without touching this component's interface.

## Addendum 2: batch 04 — Citroen, Fiat, Ford, Geely (2026-08-20)

Source: a fourth STL batch from Alejandro
(Brand_Emblems_STL_Proper_Batch_04_FIXED), README states "direct
vector-to-STL conversion from source SVG artwork, no raster tracing, no
manually recreated lettering, no substitute geometry" — same
take-at-face-value caveat as the addendum above.

Citroen: had real hand-authored geometry since the very start of this
stream (the original double-chevron work). Replaced anyway with the STL,
consistent with the priority order patterns/3d.md rule 8 now states (real
STL > traced SVG > hand-authored) and because the STL includes the full
lockup (chevron badge plus the cursive "citroën" wordmark beneath it),
more than the hand-built version modeled. chevronShape and the old
CitroenEmblem are removed, not kept dormant — the STL fully supersedes
what they did.

Fiat and Ford: both already had WMI coverage in brand.ts (ZFA, WF0/VS6)
but sat on the NameplateEmblem fallback until now. Straightforward STL
swap, no new WMI work needed.

Geely: new WMI entry (LB3), a real gap closed, not just a swap. Geely
Group brands were flagged as a coverage gap in this stream's own
research.md addendum (BYD/Chery/Geely growing fast in Europe, none had a
VIN entry). Deliberately used LB3 (Geely-badged models specifically:
Coolray, Emgrand, Atlas Pro) rather than the group-wide L6T prefix, which
is shared across Geely, Zeekr, and Geometry — mapping the shared prefix
to "geely" would misattribute a Zeekr or Geometry car as Geely-badged, a
wrong badge being worse than the generic nameplate fallback (research.md
section 5's standing principle). BYD and Chery remain unmapped; no STL
was supplied for either and no WMI research was done for them in this
pass.

Also bumped emblem size again (StlEmblem default 1.5 to 1.75, Volvo's
ring/arrow proportionally) per a second direct request in the same
session, re-checked against the card-cropping constraint in both views
before shipping — same check as the first size bump, not skipped because
it was the second time.
