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
Why: (b), exactly as the plan suggested ("rotate the whole geometry...
rotating a circle has no visible effect"). Far less error-prone than
hand-deriving rotated coordinates, and the ring's circular symmetry
means rotating it is free.
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

## No deviations from the plan's file boundary or geometry specs

All four brand components use the dimensions given in the plan
verbatim (Renault outer/inner rhombus, Mercedes ring + spoke angles,
Volvo ring + arrow dimensions, Opel ring + Blitz dimensions) with no
tuning needed — every brand read as recognizable on the first render,
so no iteration loop was required beyond the Volvo screenshot-timing
issue above. Diff touches only `src/components/emblems.tsx` (new) and
the emblem section of `src/components/VehicleScene.tsx`, confirmed via
`git diff --stat main` before the final commit.
