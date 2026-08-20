# Codex cross-exam: 3d-logos

Reviewer: Codex, 2026-08-20. Inputs read in the requested order, including
`git diff main...ws/3d-logos -- src/`.

## Answers to stage 4 questions

1. Opel fix: the constants change is the right fix. The problem was visual
recognition, not a geometry lifecycle or material separation problem. Separate
extrusion to exclude the bolt from beveling would add a second geometry path,
more cleanup surface, and a deviation from the one-mesh pattern. The current
post-review constants are the cheaper and better fit.

2. Other unattributable claims: I found no second fabricated source quote as
serious as the Volvo entry. The weakest remaining claim is "All four brand
components use the dimensions given in the plan verbatim", because Opel was
later tuned after review and Renault's rendered band thickness differs from the
nominal 0.14 constant. The post-review section now discloses both, so this is
log wording debt, not a blocker.

3. Coplanar overlaps: acceptable for this increment, but not universally safe.
Overlapping shapes inside one `ExtrudeGeometry` can create coincident faces.
With one identical material and current screenshots, this should render
consistently enough. If future work gives ring and inner marks different
materials, transparency, outlines, or shadows that reveal face ordering, remove
the overlaps or boolean-union the 2D shapes first.

4. Dev `?vin=` reachability in packaged Tauri builds: definitively not
reachable in the production package for this app. `src-tauri/tauri.conf.json`
uses `beforeBuildCommand: "pnpm build"` and `frontendDist: "../dist"`.
`pnpm build` runs `tsc && vite build`. In a Vite production build,
`import.meta.env.DEV` is replaced with false at build time. I confirmed by
building to `/private/tmp/scainner-vite-build`: the production
`VehicleScene` bundle contains no `URLSearchParams`, no `location.search`, no
`vinOverride`, no `import.meta.env`, and the minified `VehicleScene` passes the
prop VIN directly to `BrandEmblemModel`. In `tauri dev`, the override is
reachable by design through the dev server URL. In `tauri build`, there is no
remaining packaged webview surface for this override.

5. Registry typing: a future typo silently falling back to a nameplate is
acceptable for this narrow merge because it fails visually and safely. It is
not a good long-term contract. `BrandInfo.key` is `string`, so
`EMBLEMS: Record<string, React.ComponentType>` cannot prove that `renualt` is
wrong or that every modeled brand matches `brand.ts`. Follow-up should type the
known brand keys, then make the registry `Partial<Record<BrandKey,
ComponentType>>` or use `satisfies` against that key union.

## Decision-log cross-exam

1. Research: "used a confirmed top-6 ... plus general market knowledge to
build a 4-tier likelihood ranking". Acceptance with caveat. This is a weak
evidence base for market priority, but the plan used it only to choose cheap,
already-reachable geometric brands. Since no WMI edits or market claims ship
to users, the risk is contained.

2. Research: "Ruling out glTF as the primary technique early". Accepted. The
repo already had direct evidence that asset pipelines were expensive here, and
flat emblems are a better fit for procedural shapes. This decision is
proportionate to the increment.

3. Plan: "Mock VIN technique: DEV-gated query param, kept permanently".
Accepted. The production trace above supports the safety claim. My only
objection is the phrase "production behavior byte-identical"; production output
is not byte-identical because the codebase changed, but the runtime behavior of
VIN selection is equivalent.

4. Plan: "Geometry specs written as dimensions, not code". Accepted with
limited confidence. It made the builder iterate visually, which was the right
workflow. The Opel miss proves that dimensions alone are not acceptance.
Future plans should treat brand recognizability as the spec and dimensions as
starting values.

5. Build: "Correction: Volvo entry cited a plan quote that doesn't exist".
The correction is adequate. It names the fabricated quote plainly, explains
why that is a trust defect, and rewrites the Volvo decision as the builder's
own reasoning. I do not see a need for further action unless another
misattribution is found.

## Defects or risks missed by stage 4

Geometry disposal: no new blocking defect. Citroen, Renault, Mercedes, Volvo,
and Opel each allocate one geometry and one material in `useMemo`, then dispose
both on unmount. Nameplate texture and materials are also manually disposed,
while the JSX `boxGeometry` remains managed by React Three Fiber. The existing
Nameplate material array repeats the same `chrome` material five times and
disposes it five times; that is pre-existing moved behavior and is likely
harmless, but it is sloppy cleanup if this fallback gets refactored later.

Registry typing: stage 4 called out the global React type import issue, but
the deeper risk is the missing key contract with `brand.ts`. The current type
also gives reviewers no easy way to tell whether an emblem key is dead code or
reachable from a WMI. This should be hardened before several more brands are
added.

Citroen move: I do not see a subtle behavior change in the moved Citroen code.
The shape math, material values, `EMBLEM_Y`, extrude parameters, `geometry.center()`,
position, and cleanup pattern are preserved. Changing the inline extrude
options object to `EXTRUDE_SETTINGS` is value-equivalent. Importing it from a
new module does not change render behavior.

One missed minor risk: `?vin=` with an empty value in dev overrides the real
VIN with an empty string and shows the generic AUTO plate. This is harmless and
dev-only, but `vinOverride || vin` would better match tester intent if empty
query params are expected.

## Final verdict

OBJECTIONS-NONBLOCKING.

Follow-up items: type brand keys and the emblem registry before adding many
more brands; document or remove overlap-based geometry if future emblems need
multiple materials; clean the repeated material disposal in `NameplateEmblem`
when that fallback is next touched.
