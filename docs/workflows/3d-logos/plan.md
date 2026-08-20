# Plan: 3D brand emblems, increment 1 (geometric tier, hand-authored shapes)

Stream: `3d-logos`. Branch: `ws/3d-logos` in worktree `../scainner-3d-logos`.
Builder reads `roles/builder.md`, `patterns/engineering.md`, `patterns/3d.md` first.

## Goal

Real 3D emblem geometry for four high-impact geometric marks (Renault, Mercedes-Benz, Volvo, Opel), hand-authored as `THREE.Shape` outlines extruded the same way the existing Citroen chevrons are. Everything else keeps the nameplate fallback. Emblem code moves to its own module so VehicleScene.tsx stops growing.

## Non-goals

- No SVG pipeline (SVGLoader etc). Deferred until several hole/curve marks are built together.
- No figurative marks (Peugeot lion, Mazda wings, wordmarks). Nameplate is the correct answer for those, not a stopgap.
- No WMI table changes. The research flagged no concrete corrections, only a future full re-verification, so `src/lib/brand.ts` is untouched in this increment.
- No BMW, VW, Toyota, Audi, Mitsubishi (see decision log). No material, lighting, or camera changes.

## File boundary

- NEW `src/components/emblems.tsx`: EMBLEM_CHROME, EMBLEM_Y, chevronShape, CitroenEmblem, NameplateEmblem (all moved verbatim from VehicleScene.tsx), the four new emblem components, and an exported registry `EMBLEMS: Record<string, ComponentType>`.
- `src/components/VehicleScene.tsx`: ONLY the emblem section. Delete the moved code, import from `./emblems`, and in BrandEmblemModel select via `EMBLEMS[brand.key] ?? NameplateEmblem`. Plus the dev VIN override (step 1). Nothing else in this file changes.
- Nothing else. No other file may be edited.

## Shared constraints (patterns/3d.md rule 7 and 8)

Each emblem: centered on origin by `geometry.center()`, positioned at `[0, EMBLEM_Y, 0]`, total width at most ~1.4 and height at most ~1.1 (Citroen is 1.32 x ~0.95; match that visual weight). Extrude depth 0.15, bevel 0.025/0.025/3 segments, material `new THREE.MeshPhysicalMaterial(EMBLEM_CHROME)`, dispose geometry and material on unmount (copy the CitroenEmblem pattern exactly). Rings use `THREE.Shape.absarc` with an inner-circle hole pushed to `shape.holes`; keep curveSegments around 24, triangle counts modest.

## Brand geometry specs

1. **Renault** (key `renault`): diamond ring. Outer rhombus 0.95 wide x 1.10 tall (4 points on the axes), inner rhombus hole scaled to leave a constant-looking band ~0.14 thick. One closed Shape with one hole.
2. **Mercedes-Benz** (key `mercedes`): three-pointed star in a ring. Ring: annulus, outer radius 0.55, band 0.07 (outer absarc + inner hole). Star: three elongated 4-point rhombi (spokes) from center to the ring's inner edge, at angles 90, 210, 330 degrees; each spoke ~0.13 wide at center tapering to a point at the tip. Extrude ring and spokes together as one shape array.
3. **Volvo** (key `volvo`): circle with a diagonal arrow (Mars symbol). Ring: outer radius 0.48, band 0.09. Arrow at 45 degrees upper-right, starting at the ring's outer edge: shaft = rotated rectangle ~0.22 long x 0.09 thick, head = solid triangle ~0.22 wide x 0.18 long at the shaft's end. Total width including arrow stays within 1.4.
4. **Opel** (key `opel`): circle crossed by a horizontal lightning bolt. Ring: outer radius 0.52, band 0.08. Blitz: one closed Z-shaped band of constant thickness ~0.12, spanning the full horizontal diameter: left horizontal arm, diagonal step down through center, right horizontal arm; the arm tips meet the ring's inner edge.

## Steps (each independently verifiable; commit each)

1. **Extract + dev override.** Create `emblems.tsx` by moving the existing emblem code, wire the registry into BrandEmblemModel, and add the dev VIN override: in VehicleScene, `const vinOverride = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("vin") : null;` and pass `vinOverride ?? vin` to BrandEmblemModel. Verify: `npx tsc --noEmit` clean; browser demo Citroen flow renders the chevrons exactly as before (screenshot); `?vin=WF0XXXXXXXXXXXXXX` shows the FORD nameplate (screenshot proves the override works).
2. **Renault proof (the risk gate).** Build RenaultEmblem only. Verify with `?vin=VF1AAAAAAAAAAAAAA`: two screenshots at different rotation angles (spaced a few seconds; connect flow per engineering.md rule 1) showing a recognizable Renault diamond. If it reads as a blob, iterate on band thickness / scale / bevel first. **Fallback: if after iteration it still does not read, STOP, do not build the other three, report to the orchestrator with the screenshots.** Only a recognizable Renault unlocks steps 3-5.
3. **Mercedes.** Verify with `?vin=WDBAAAAAAAAAAAAAA`, two angles.
4. **Volvo.** Verify with `?vin=YV1AAAAAAAAAAAAAA`, two angles.
5. **Opel.** Verify with `?vin=W0LAAAAAAAAAAAAAA`, two angles.
6. **Final pass.** `npx tsc --noEmit` clean; re-screenshot the plain demo flow (no `?vin=`) confirming Citroen unchanged; confirm no file outside the boundary changed (`git diff --stat main`); write `decisions-build.md`.

## Acceptance criteria

- Per brand (Renault, Mercedes, Volvo, Opel): screenshots at 2+ rotation angles in the running app where the mark is recognizable as that brand at card size.
- `npx tsc --noEmit` clean. No Rust touched, so no cargo check needed.
- Demo Citroen flow unchanged (screenshot, chevrons identical in framing and material).
- Diff touches only `src/components/emblems.tsx` and the emblem section of `src/components/VehicleScene.tsx`.
- Dev VIN override is DEV-gated and inert in production builds.

## Demonstration

Branch `ws/3d-logos`, one small commit per step above. PR on `cxalem/scainner` with: plain-language summary of what changed, manual test instructions (the `?vin=` URLs from the steps), all verification screenshots embedded, and links to `review-report.md` and `codex-review.md` once stages 4-5 add them.
