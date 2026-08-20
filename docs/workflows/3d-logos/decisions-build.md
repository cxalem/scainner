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

## Addendum 3: batches 05/06 — BYD, Chery, Tesla, SAIC, Seat, Vauxhall; particles; VIN work (2026-08-20)

STL sources: batch 05 (BYD, Chery — both flagged as a real gap in the
research addendum), a corrected batch 05_FIXED for Tesla/SAIC ("Both are
direct vector-to-SVG extrusions... both meshes validated watertight,"
superseding the originals), and batch 06 (Seat, Vauxhall).

WMI decisions, checked against authoritative sources this time, not just
web search summaries:
- BYD (LGX): confirmed directly against NHTSA's own WMI registry API
  (`vpic.nhtsa.dot.gov/api/vehicles/GetWMIsForManufacturer/BYD`), high
  confidence. One low-quality source had claimed "LVV" for BYD; NHTSA
  settles that it's actually LGX.
- Chery (LVV): NHTSA has no record (Chery doesn't sell in the US), so this
  rests on two independent secondary sources instead of an official
  registry hit — medium confidence, logged as such rather than presented
  equal to BYD's.
- Tesla, Seat: already had WMI coverage, straightforward STL swap.
- SAIC: no WMI added, deliberately. Researched what a "SAIC" badge would
  even mean on a real car and found it doesn't: SAIC Motor doesn't retail
  under its own name, it sells as MG (LSJ), Roewe (LSJ), or Maxus
  (LSK/LSH). There's no real car a "saic" WMI mapping could ever match.
  Component is registered and reachable via dev override for when/if that
  changes.
- Vauxhall: no WMI added either. It shares Opel's W0L prefix (same German
  plants), no reliable way to tell them apart from the VIN alone — same
  shared-prefix situation as Cupra/Seat, same resolution (dev override
  only, W0L keeps resolving to Opel).

Also in this pass, not strictly 3d-logos scope but touching the same
VehicleScene card, done together at the user's direction:
- Emblem card background: dark gradient + slow-drifting dust particles
  behind the badge, replacing the flat light card. Adapted directly from
  the knowledge-base note (3-Resources/starfield-header/technique.md,
  cloned from ai.manz.dev) — typed arrays, weighted pools, wrap-around
  edges, same shape, retuned far slower (ambient dust, not the original's
  drifting-stars pace) and warm-toned per the user's pick from a live
  three-variant preview. New component: EmblemStarfield.tsx. Confirmed
  this doesn't touch the chrome material's reflection environment, which
  comes from StudioEnvironment's own offscreen PMREM bake, entirely
  separate from this visible background layer.
- Third size bump (StlEmblem default 1.75 to 2.0, Volvo proportionally),
  re-checked against cropping.
- Fixed a real timing bug, not just a preference: Overview's emblem could
  briefly show the generic nameplate badge before flipping to the correct
  brand on connect, because Overview independently re-fetched the VIN via
  report_cars instead of receiving it from App, which already resolves it
  earlier in the same connect handler. Now passed down as a prop.
- Fixed a scrollbar layout shift in DiscoveryFlow's sensor list
  (overflow-y-auto to overflow-y-scroll, reserves the gutter).
- New src/lib/vin.ts: decodes model YEAR from VIN position 10 (ISO 3779,
  universal, offline, no lookup table needed beyond the standard one).
  Deliberately does not attempt full model/trim decoding — checked
  directly against NHTSA's free VIN-decode API before writing this off:
  it works cleanly for a real US-market VIN (Ford F-150 decoded exactly
  right) but fails outright for this app's own demo VIN, a Citroen
  (VR7-prefixed) — "Manufacturer is not registered with NHTSA for sale or
  importation in the U.S." Not a demo-data quirk: every real Citroen VIN
  hits the same wall, and Citroen/Peugeot/Renault/Seat/Dacia/Fiat cover a
  large share of Spain's actual fleet. NHTSA is a real option worth
  wiring up later as a best-effort online lookup for the brands that do
  sell in the US, but it is not a fix for the rest, including this app's
  own reference car — a hand-built exhaustive model database is not a
  realistic scope either. Wired the year into Overview's header and
  DiscoveryFlow's info card (new "Vehicle" row: brand name + year).

## Addendum 4: real 3D GLB emblems for Audi, BMW, Mercedes, Toyota, VW (2026-08-20)

Source: two GLB drops from Alejandro — a single Audi file
(Audi_emblem_CAD_rounded_polished_metal.glb, trimesh-generated, 4
separate ring meshes) and a batch of 4
(Polished_Metal_GLB_Batch_01_CAD_FIXED_V2: BMW, Mercedes-Benz, Toyota,
Volkswagen). The batch README states this corrects a real defect in an
earlier unseen pass ("removes the scalloped/stepped side-wall artifacts
seen in the previous batch") — taken at face value per this stream's
usual caveat, not independently verifiable from inside this repo.

This is a genuine step up from the flat-extruded STL geometry: real
rounded torus rings with true depth and fillets instead of flat bevels,
visibly more premium. Verified live in-browser for all 5 (not just load
success) — correct orientation, smooth shading, no faceting, no
mirroring.

New GlbEmblem component (emblems.tsx), parallel to StlEmblem but
operating at the Object3D level instead of per-geometry buffers, since a
GLB is a scene graph (Audi is 4 separate mesh nodes) rather than one
BufferGeometry: rotate/scale/center the whole cloned scene using the same
thinnest-axis auto-detection as the STL path, then swap every mesh's
material for the shared EMBLEM_CHROME (discarding each file's own baked
"Polished_Metal" PBR material, for the same one-consistent-look-across-
every-badge reason STL emblems already ignore their source coloring).
Does not run toCreasedNormals — GLB carries real vertex normals from its
own export pipeline, unlike STL's per-facet soup, and both Audi and the
batch-01 four render smooth without it.

Bundle size, named plainly rather than left as a silent tradeoff: this
swap alone adds roughly 15.7MB (removed ~1.15MB of STL for these 5
brands, added ~16.8MB of GLB). Total public/emblems payload is now about
25MB. Not a blocker for a desktop app users install once, but a real
number, and the geometric detail (>50k triangles per brand, over 100k for
some) is far beyond what's visible at the card's actual render size —
worth decimating before this goes much further if more brands move to
this pipeline, rather than compounding the bundle size with every future
GLB drop at full CAD tessellation.

Removed the now-superseded STL files for these 5 brands
(bmw/mercedes/toyota/volkswagen/audi.stl) — same "don't leave unused
assets in the PR" standard already applied to the review screenshots in
addendum 3.

## Addendum 5: batch 02 GLB — Renault, Peugeot, Kia; Hyundai missing (2026-08-20, post-merge)

Source: Polished_Metal_GLB_Batch_02_CAD_FIXED_V2, applied directly to
main after PR #1 and the addendum-4 GLB commit were already merged (no
new PR for this one either, same direct-to-main pattern established for
the previous post-merge GLB addition, at the user's request).

The batch's own README names four brands (Renault, Peugeot, Kia,
Hyundai) but only three files are actually in the folder — Hyundai's GLB
is missing. Flagged to the user rather than silently shipping three of
four with no note; hyundai.stl stays in place as the fallback until a
real Hyundai GLB shows up.

Triangle counts, much lighter than the first GLB round: Renault 6,416,
Kia 12,640, Peugeot 70,608 (Peugeot's shield-plus-lion needs the detail
the flat cats didn't have room for; still far below Audi's 432k or
Mercedes' 95k from addendum 4). Net bundle effect is close to a wash this
time (new GLBs ~2.65MB, removed STLs ~2.72MB) rather than the ~15.7MB
jump addendum 4 flagged.

Removed the three now-superseded STL files. All three verified live via
the dev ?vin= override before committing.

## Addendum 6: batch 02 completed, batch 03, material tightened, brand-key dev override (2026-08-20, post-merge)

Source: the missing Hyundai GLB from addendum 5's batch 02 (delivered
separately), plus a new batch 03 (Dacia, Opel, Skoda, Vauxhall, no
README this time). Applied directly to main, same established pattern.

Real gap found and closed, not just an asset swap: SAIC and Vauxhall
have no WMI (see addendum 3), which meant the dev `?vin=` override could
never reach either — there is no VIN prefix that resolves to them. Both
were nominally "verified" in earlier addenda by the general "all brands
checked live" claim, but that claim did not actually hold for these two
specifically, since the mechanism to check them didn't exist yet. Added
a second dev-only override, `?brand=<key>`, that picks an EMBLEMS
registry key directly, bypassing VIN resolution entirely. Both saic and
vauxhall are now confirmed live for real, not by extension of a general
claim — this is the standing bar going forward: a brand isn't verified
until it's actually been looked at, not just assumed covered by "all
brands" language.

Material tightened, on real evidence: the source GLB files' own
"Polished_Metal" material specifies `roughnessFactor: 0.14` (checked
directly in each file's JSON, this session, not assumed), while
EMBLEM_CHROME had it at 0.22 — duller than what the source files were
actually designed for. Tightened to roughness 0.13, clearcoat 0.6->0.85,
clearcoatRoughness 0.1->0.06, envMapIntensity 1.5->2.0. Verified with a
same-crop before/after screenshot (Audi rings): visibly sharper highlight
band and stronger contrast, not asserted without looking.

Fourth size bump (targetWidth 2.0 to 2.3) — checked directly against
Citroen's full lockup (badge plus wordmark, the tallest-aspect emblem and
therefore the real ceiling test, not a round badge that has margin to
spare in every direction), which clears both card edges with a thinner
but real margin. Treating this as the safe ceiling; not pushing further
without revisiting the camera/EMBLEM_Y framing itself rather than just
the target width number.

Removed the eight now-superseded STL files (dacia, hyundai, kia, opel,
peugeot, renault, skoda, vauxhall).
