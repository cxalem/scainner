# Review report: 3d-logos, stage 4

Reviewer: Claude (Fable 5), 2026-08-20. Branch `ws/3d-logos` at b8b9f12,
reviewed in the worktree against `main...ws/3d-logos`.

## Verdict: fix-then-ship

The extraction, the registry, the dev VIN override, and three of the four
new emblems (Renault, Mercedes, Volvo) are correct, clean, and verified in
the running app. The one fix-worthy defect is the Opel Blitz: at card size
it reads as a soft wave inside a circle, not a lightning bolt, so the
plan's own acceptance criterion ("recognizable as that brand at card
size") is not met for Opel. The fix is a small constants change inside
OpelEmblem. Everything else below is log hygiene or hardening notes.

## Scope check

Diff touches exactly the promised boundary and nothing else:

- `src/components/emblems.tsx` (new, 306 lines)
- `src/components/VehicleScene.tsx` (emblem section only: moved code
  deleted, import added, registry lookup in BrandEmblemModel, dev
  override in VehicleScene)
- `docs/workflows/3d-logos/decisions-build.md` (the committed log)

No other file changed. `src/lib/brand.ts` untouched as promised. Commit
sequence (dfb3676 extraction, a52106f Renault, 2965dac Mercedes, 79de251
Volvo, 3fb87f7 Opel, b8b9f12 log) matches the plan's step order, so the
Renault risk gate was real, not cosmetic. The moved Citroen and Nameplate
code is verbatim except the extrude options literal becoming the
`EXTRUDE_SETTINGS` constant (same values, and the change is covered by
the builder's curveSegments log entry). One trivial deviation from the
plan's wording: selection is `(brand && EMBLEMS[brand.key]) ?? null` with
a JSX fallback rather than `EMBLEMS[brand.key] ?? NameplateEmblem`;
semantically identical, since NameplateEmblem needs the `name` prop.

## My verification (independent, not the builder's)

- `npx tsc --noEmit`: clean.
- Console during all flows: only the pre-existing `THREE.Clock`
  deprecation warning; nothing from the new code.
- Dev server `vite --port 1422`, browser demo, full connect flow
  (Connect, ~15s discovery, Go to dashboard) run separately per brand so
  every screenshot below is from the connected, slowly rotating state.

Screenshots (saved in `docs/workflows/3d-logos/review-screenshots/`,
untracked, for the PR stage to embed):

| Brand | Evidence | Judgment at card size |
| --- | --- | --- |
| Renault (?vin=VF1...) | `renault-frontal.png`, `renault-three-quarter.png` | Clearly the Renault losange. Good. |
| Mercedes (?vin=WDB...) | `mercedes-frontal.png`, `mercedes-three-quarter.png` | Clearly the three-pointed star in a ring. Good. |
| Volvo (?vin=YV1...) | `volvo-frontal.png`, `volvo-three-quarter.png` | Ring plus upper-right arrow reads as the iron mark. Good. |
| Opel (?vin=W0L...) | `opel-frontal.png`, `opel-frontal-zoom.png`, `opel-three-quarter.png` | Weak. See finding 1. |
| Ford fallback (?vin=WF0...) | `ford-nameplate.png` | FORD nameplate slab renders, override cannot break the fallback path. |
| Citroen regression (no ?vin=) | `citroen-angle1.png`, `citroen-angle2.png` | Chevrons identical in framing and material to before the extraction. |

I also confirmed the builder's Volvo observation: the slow connected
rotation (~39s/turn) spends long stretches near edge-on, where any of
these flat marks proves nothing; the shots above were taken at
informative angles.

## Findings, ranked

1. **Opel Blitz does not read as a lightning bolt (medium, gates ship).**
   The frontal view (`opel-frontal-zoom.png`) shows a circle crossed by a
   gentle S-wave. Cause is the plan's own constants amplified by the
   bevel: the diagonal drops only `stepY 0.16` over a run of about 0.4
   (slope ~0.4), and the 0.025 bevel rounds off the two corners that make
   a bolt look like a bolt. The plan spec was followed; the acceptance
   criterion was not met. Proposed fix, inside OpelEmblem only: steepen
   and shorten the step (stepY around 0.26 to 0.30, armLen around
   `innerR * 0.62` so the diagonal run shrinks), and if it still reads
   soft, add the real Blitz's small vertical tips at the two elbows.
   Iterate against `?vin=W0L...` exactly as the Renault gate did.
2. **Builder log misquotes the plan (low).** The Volvo entry says the
   rotate-the-whole-geometry approach was "exactly as the plan suggested
   ('rotate the whole geometry... rotating a circle has no visible
   effect')". That sentence does not appear in plan.md; the plan's Volvo
   spec never mentions rotation strategy. The decision itself is sound,
   but a log that invents a plan citation undermines trust in the other
   entries. Fix: reword the entry to own the decision instead of
   attributing it to the plan.
3. **Renault band is ~0.11 thick, not the spec's ~0.14 (low).** The
   inner rhombus is offset 0.14 measured along the axes; the resulting
   perpendicular band thickness is 0.14 x 0.55 / sqrt(0.475^2 + 0.55^2)
   which is about 0.106. The band IS genuinely constant thickness (the
   code comment's claim checks out) and the mark reads fine, so no
   geometry change needed. Fix: one-line comment correction in
   RenaultEmblem noting the true rendered thickness, so future brands do
   not copy 0.14 expecting 0.14.
4. **Coplanar overlaps inside single extrusions (info, no action).**
   Mercedes spokes overlap the ring by 0.02, the Volvo shaft starts 0.03
   inside the ring's outer edge, and the Opel Blitz tips poke slightly
   into the band (the tips at x = +-innerR sit where the inner circle
   has already curved away). Overlapping shapes in one ExtrudeGeometry
   produce coincident faces at identical depth. No artifact is visible
   today because everything shares one material, so coincident fragments
   shade identically. Worth knowing before anyone gives ring and mark
   different materials.
5. **Builder's claimed screenshots are not in the repo (info).** The
   decision log leans on screenshots ("screenshots for both brands
   show..."), but no image was committed or left in the worktree, so the
   builder's visual evidence is unauditable. Harmless here because I
   re-verified everything independently, and the plan defers embedding
   screenshots to the PR stage, but the PR author must regenerate them.
   The log also has a typo ("gemetry").

Minor code notes, no action required: the registry type
`Record<string, React.ComponentType>` uses the React UMD global type
without importing `ComponentType` (tsc accepts it; an explicit type
import would be cleaner). In dev only, `?vin=` with an empty value yields
the empty string, which is not null, so `"" ?? vin` short-circuits to ""
and shows the AUTO nameplate; irrelevant to production because
`import.meta.env.DEV` is false there and the whole branch folds to
`null`, leaving `vin` untouched. I confirmed the override is inert when
the param is absent (`get("vin")` returns null) and that the default
demo flow renders Citroen from the mock VIN with no param present.

## Decision log audit

Every structural surprise in the diff has a log entry: the second
extrude-settings constant, the one-extrude-call-per-brand choice, the
Volvo rotation approach, and the sequencing correction (which is an
honest and creditable entry). The in-code comments cover the smaller
surprises (Mercedes spoke base offset 0.02 to avoid degenerate triangles,
Volvo shaft starting 0.03 inside the ring). The two log defects found are
finding 2 (invented plan quote) and the "dimensions used verbatim, no
tuning needed" claim, which is true for the constants but glosses over
finding 3's spec-vs-rendered mismatch.

## Questions for the Codex cross-exam

1. Opel: given the plan's constants produce a wave, is the right fix the
   constants change proposed in finding 1, or should the Blitz corners be
   excluded from the bevel (separate extrude for the bolt) to keep them
   sharp? Which is cheaper to keep within the one-mesh dispose pattern?
2. The builder log fabricates a plan quote for the Volvo rotation
   decision. Spot-check the other entries against plan.md and the diff:
   are any other claims unattributable?
3. Are the coincident coplanar faces from overlapping shapes in one
   ExtrudeGeometry (finding 4) safe across GPUs and devicePixelRatios,
   or should the overlaps be removed while everything still shares one
   material?
4. Can `import.meta.env.DEV` ever be true in a shipped Tauri build of
   this app (tauri dev vs tauri build), and does the `?vin=` override
   have any reachable surface in the packaged webview where
   location.search could be attacker- or user-controlled?
5. The registry is keyed by `brand.key` strings with no compile-time
   link to brand.ts keys. Is a typo in a future key (silently falling
   back to the nameplate) acceptable, or should the key union be typed?
