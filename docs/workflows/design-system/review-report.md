# Review: design-system stream (ws/design-tokens)

Reviewer pass, 2026-08-21. Scope: 3 commits on `ws/design-tokens`
(e8d1c4a theme module, 3412f39 vitest + tests, 96f7312 migration),
diffed against merge-base with main. Everything below was re-verified
directly in this worktree, not taken from the builder's report.

## Verdict: SHIP (with one small fix applied in review)

The migration is correct, byte-identical, visually verified live, and
tested. One latent weakness in a test was fixed during review (see
finding 1); no defects remain that I could find. One cross-stream merge
question must go to whoever merges this and `ws/car-data` — flagged at
the bottom, it is not resolvable from this worktree alone.

## Verification evidence (all re-run by the reviewer)

**Forced real test run, not a cached replay.** Ran `npx vitest run`
directly inside `apps/desktop` (bypassing turbo entirely, per the
2026-08-21 reviewer-policy warning about turbo cache replay reporting
success while executing nothing). Result: 2 test files, 8 tests, 8
passed, ~84ms. Re-ran after the review fix: 8/8 again. `npx tsc
--noEmit` clean both times.

**Zero code-level hex/rgb literals in the three migrated files —
confirmed by my own grep.** `grep -nE '#[0-9a-fA-F]{3,8}\b|rgb\('` over
`VehicleScene.tsx`, `emblems.tsx`, `EmblemStarfield.tsx` returns exactly
three hits, all inside `//` comments (VehicleScene.tsx lines ~699/700/
715: the `~#8f939c`, `~#a0a0a2`, `~#8d969c` provenance notes explaining
where the STL paint/glass colors were sampled from). Those are
documentation, deliberately kept; no code-level literal remains.

**Byte-identical values — checked against git history, not against the
test.** I extracted every color value from the merge-base versions of
all three files (`git show <merge-base>:...`) and compared each against
`src/theme/rendering.ts` directly. All match exactly — well beyond the
5-value spot-check bar:

- Chrome: `#f4f6f8`, metalness 0.9, roughness 0.13, clearcoat 0.85,
  clearcoatRoughness 0.06, envMapIntensity 2.0
- Nameplate canvas: `#ffffff` base, `#181a1e` text
- Studio rig: backdrop (0.32,0.34,0.37), panels (2.4,2.4,2.4) /
  (1.3,1.5,1.8) / (1.8,1.5,1.2), floor `#3a3a3a`, rim `#dfe8ff`
- Starfield: dust `#fff6e6`/`#f0e6d2`/`#c9b995`, gradient
  `#181614`→`#221f1b`
- Vehicle materials: `#e3e5e8`, `#2b2f36`, `#989ba1`, `#17191c`,
  GLB tuples (0.68,0.7,0.72)/(0.25,0.28,0.32)/(0.08,0.08,0.09)/
  (0.85,0.85,0.85)/(1,1,1), `#0d1116`, `#ffffff`, `#ff2a2a`, `#eaf1ff`

The `rendering.test.ts` assertions also hold, but the check above is
independent of them — a wrong test asserting a wrong constant would
have been caught.

**Live visual check — done, and justified.** This is reviewer-policy
case (b): color is inherently visual, a value-equality test cannot
prove the render pipeline imports the right constant at the right call
site (a transposed import would typecheck and pass the value test).
Ran the vite browser demo (`pnpm dev`, mock data) headless via
Playwright, walked the documented connect flow, landed on the dashboard
with `?brand=audi`:

- Screenshot: silver chrome Audi rings over the warm dark starfield
  with cream dust particles — the expected look, no visible color
  regression anywhere in the scene.
- Pixel-exact: sampled the EmblemStarfield 2D canvas via
  `getImageData` — top-left `#181614`, bottom-right `#221f1b`, exactly
  the migrated `PARTICLE_PALETTE.backgroundGradient` values live on
  screen. (The WebGL canvas can't be sampled the same way; the
  screenshot covers it.)

A true before/after against main was not done — running main's copy
lives in another worktree this review is barred from touching — but
byte-identical constants + a correct live "after" render + per-call-site
diff reading (every replacement sits at the original site with the
matching semantic name) closes the same gap.

**`dom.test.ts` reads `index.css` directly — claim confirmed, and it's
a genuinely good pattern.** The test parses the real
`src/index.css` at test time and asserts `DOM_TOKENS` covers every
custom property declared there (minus `--radius`, a documented layout
exception) and names nothing that doesn't exist. No hand-copied second
list anywhere, so adding a token to `index.css` without updating
`dom.ts` fails the suite. Worth citing as precedent for other streams:
when a test's job is "these two artifacts agree," read one of them for
real instead of transcribing it.

**No Rust touched.** `git diff --name-only main...HEAD`: only
`apps/desktop/src/**`, the two `package.json`s, `turbo.json`,
`pnpm-lock.yaml`. Nothing under `src-tauri/`, so `cargo check` is
unaffected by construction; it was not re-run for that reason.

**Scope vs. plan.** All three plan items delivered (theme module,
three-file migration, brand-identity-vs-rendering-constants distinction
documented in `index.ts`/`rendering.ts`/`dom.ts` headers). The vitest
infra was not in plan.md but is mandated by patterns/engineering.md
rule 11 (added 2026-08-21, after the plan) — compliance with a newer
repo rule, not scope creep. The `EMBLEM_CHROME` re-export in
`emblems.tsx` is explained inline (docs reference that name). No
unexplained surprises found in the diff.

## Findings

**1. (Fixed in review) `dom.test.ts` drift guard had silent blind
spots.** The original parse matched token names as `--[a-z-]+` with a
value filter of `oklch|...rem`. A future token with a digit in its name
(`--chart-1`) or a non-oklch value (a hex or hsl color) would have been
silently excluded from the "declared" set — the drift guard would
quietly stop guarding exactly the tokens most likely to be added later,
with all tests still green. Fix applied (commit in this branch): the
parse is now scoped to the `:root { ... }` blocks (which is what the
value filter was really standing in for — excluding the `@theme inline`
mapping block) and matches any `--[a-z0-9-]+` name with any value.
Verified: 8/8 pass, and a simulated `:root` block containing
`--chart-1: #abc123` is now caught by the parse where the old regex
missed it.

**2. (Judgment, no change requested) App-local placement is right, but
for a slightly better reason than the builder gave.** The builder's
framing: `dom.ts` is DOM-only (meaningless on React Native), and
`rendering.ts`, while portable plain JS, has no second consumer yet
(apps/mobile has no UI/R3F). The "no consumer yet" half undersells the
real argument and invites the rebuttal that extracting pure data to
`packages/theme` now would be nearly free. The stronger reason:
`rendering.ts` is not brand-neutral theme data — it is scene-coupled
data. `STUDIO_LIGHTING` describes this app's specific softbox rig,
`VEHICLE_MATERIALS` keys off this app's specific GLB material names and
model files, `CHROME_MATERIAL` is tuned to these emblem assets. A
mobile app could only consume these by shipping the same R3F scene, at
which point the scene components would need extraction too — and the
right package boundary would be "the scene" (components + constants
together), not a constants-only theme package carved out today. Drawing
the smaller boundary now would likely be the wrong boundary. So:
placement sound, deferral cheap to reverse (pure data, no side
effects), consistent with the repo's anti-speculation rule (engineering
rule 11's "don't build it until a stream needs it"). No contradiction
with the car-data bar — the bar there was platform coupling, the bar
here is scene coupling; both resolve to "app-local until a real second
consumer exists."

**3. (For the merger of both streams — cannot be resolved here)
Vitest config overlap with ws/car-data.** Both branches independently
added test infra. Compared directly via
`git diff main...ws/car-data` (read-only; that worktree untouched):

- Root `package.json` and `turbo.json`: byte-identical additions
  (`"test": "turbo run test"`, `test` task with `dependsOn: ["^build"]`).
  Merge clean.
- `apps/desktop/package.json`: both add `"test": "vitest run"` and
  `vitest: "^4.1.11"` (same version — no dual-install risk). car-data
  additionally adds `test:watch`; design-tokens additionally adds
  `@types/node` (genuinely needed here — `dom.test.ts` imports
  `node:fs`). Insertions land at different positions, so expect a
  trivial textual conflict; the correct resolution is the union of all
  four additions.
- `pnpm-lock.yaml`: both add ~240 lines for vitest — will conflict;
  resolve by re-running `pnpm install` after merging the manifests,
  don't hand-merge the lockfile.
- The one semantic (non-textual) difference: car-data adds
  `apps/desktop/vitest.config.ts` (node environment + `@`→`src`
  alias); design-tokens adds none, so on this branch vitest falls back
  to `vite.config.ts` (which happens to carry the same alias plus
  Tauri-dev plugins tests don't need). After both merge,
  `vitest.config.ts` takes precedence and `vite.config.ts` stops
  influencing tests. I verified this branch's tests survive that
  switch: both theme test files use only relative imports and node
  builtins, and run under a node environment already. car-data's
  config is also the better end state (no react/tailwind plugins
  loaded for unit tests). **Question for the merger:** after both
  land, run the full suite once, forced (`npx vitest run` inside
  apps/desktop, or `turbo run test --force`) to confirm all ~20+ tests
  pass under the single surviving config — and watch specifically that
  turbo doesn't replay either branch's green cache from before the
  merge.

**4. (Note, no action) Cosmetic dependency reorder.** Both branches
identically moved `@scainner/core` to alphabetical position in
`apps/desktop/package.json` dependencies — harmless, merges clean, but
worth knowing it's in both diffs so it doesn't look like a real change
during the merge.

## Questions for the Codex cross-exam

1. Finding 3's merged-config test run: was it done, forced, and did the
   union `package.json` resolution keep `test:watch` and `@types/node`?
2. `readDomToken` in `dom.ts` is currently exported but has no caller
   in the app. It's documented as "for the rare case JS genuinely needs
   a token's live value." Dead-export-on-arrival is a defensible seam
   given rendering.ts's header points at it, but confirm the team is
   fine shipping an unused export rather than adding it when first
   needed.
3. The starfield's `COLOR_WEIGHTS` / `SIZES` / `SIZE_WEIGHTS` stayed in
   `EmblemStarfield.tsx` while its colors moved to the theme. That line
   (colors are theme, geometry/distribution is behavior) looks right —
   push on whether the same line was drawn consistently in
   `VehicleScene.tsx` (it was, from my read: intensities, opacities,
   and positions stayed put; only colors moved).
