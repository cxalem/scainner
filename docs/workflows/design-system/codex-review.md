# Codex cross-review: design-system stream

Second independent reviewer pass, 2026-08-21. Reviewed as `main...HEAD`
from merge-base `4d892769f33f4603a22210a951729a2fd9797855`.

## Verdict: SHIP

I found no blocking defect and no nonblocking code-change objection. The
change does what the plan asked: it documents the existing DOM/CSS token
source of truth, moves the 3D/Canvas color constants out of three component
files into `apps/desktop/src/theme/`, preserves the existing values, and adds
Vitest coverage that actually exercises the token module.

## Verification run

- Read, in order: `docs/workflows/roles/reviewer.md`,
  `docs/workflows/patterns/engineering.md` rule 11,
  `docs/workflows/design-system/plan.md`, then the diff and commits, then
  `docs/workflows/design-system/review-report.md`.
- `git log --oneline main..HEAD` shows the expected four commits:
  `e8d1c4a`, `3412f39`, `96f7312`, `3776871`.
- Forced real test execution, bypassing Turbo cache: ran `npx vitest run`
  inside `apps/desktop`.
  Result: Vitest 4.1.11, 2 test files passed, 8 tests passed, duration
  146ms.
- Ran `npx tsc --noEmit` inside `apps/desktop`; clean.
- No Rust or `src-tauri/` files changed, so I did not run `cargo check`.

## Findings

No blocking or nonblocking findings.

## Claims checked from the first review

**Code-level color literals removed.** Verified with:

`grep -nE '#[0-9a-fA-F]{3,8}\b|rgb\(' apps/desktop/src/components/VehicleScene.tsx apps/desktop/src/components/emblems.tsx apps/desktop/src/components/EmblemStarfield.tsx`

The only hits are comment-only provenance notes in `VehicleScene.tsx`:
`~#8f939c`, `~#a0a0a2`, and `~#8d969c`. No executable hex or rgb literal
remains in the three migrated files.

**Byte-identical migration spot-checks.** I checked pre-migration values
with `git show 4d892769f33f4603a22210a951729a2fd9797855:<file>` and
compared them against `apps/desktop/src/theme/rendering.ts`. Sampled more
than the requested five:

- `emblems.tsx` old `EMBLEM_CHROME.color` `#f4f6f8`,
  `roughness: 0.13`, `clearcoat: 0.85`, `envMapIntensity: 2.0` match
  `CHROME_MATERIAL`.
- `emblems.tsx` old nameplate `ctx.fillStyle` values `#ffffff` and
  `#181a1e` match `NAMEPLATE_TEXTURE`.
- `EmblemStarfield.tsx` old `PALETTE`
  `#fff6e6`, `#f0e6d2`, `#c9b995` and gradient `#181614` to `#221f1b`
  match `PARTICLE_PALETTE`.
- `VehicleScene.tsx` old studio backdrop `(0.32, 0.34, 0.37)`, panels
  `(2.4, 2.4, 2.4)`, `(1.3, 1.5, 1.8)`, `(1.8, 1.5, 1.2)`, floor
  `#3a3a3a`, and rim `#dfe8ff` match `STUDIO_LIGHTING`.
- `VehicleScene.tsx` old material values `#e3e5e8`, `#2b2f36`,
  `#989ba1`, `#17191c`, `setRGB(0.68, 0.7, 0.72)`,
  `setRGB(0.25, 0.28, 0.32)`, `#0d1116`, `#ff2a2a`, and `#eaf1ff`
  match `VEHICLE_MATERIALS`.

This check is independent of `rendering.test.ts`; the test could have
asserted a wrong copied value and these history checks would still catch it.

**`dom.test.ts` hardening.** The first reviewer was right that the current
test no longer has the original blind spots for digit-named tokens or
non-oklch values. I simulated a `:root` block containing
`--chart-1: #abc123` and `--accent-hsl: hsl(...)`; both are captured by
the current parse. I did find one theoretical remaining edge:
`--foo_bar` would not be captured because the token-name regex is
`--[a-z0-9-]+`. CSS custom properties permit broader identifier syntax than
this. I am not treating that as a defect because the app's token convention
is lowercase hyphenated names and Tailwind-style token names; accepting
underscores or escaped CSS identifiers is unnecessary for the current file.

**Live visual verification.** I attempted to run an independent browser
session because this is reviewer-policy case (b): color rendering is visual.
It is blocked in this sandbox. `pnpm dev -- --host 127.0.0.1 --port 5173`
fell back to the configured Tauri port and failed with
`listen EPERM ... ::1:1420`; direct `npx vite --host 127.0.0.1 --port 5173`
also failed with `listen EPERM ... 127.0.0.1:5173`. I therefore did not
perform a live Audi/starfield check in this pass. This does not change my
verdict because the constants are byte-identical, the migrated call sites
are direct semantic substitutions, and the first reviewer already recorded
a successful live/pixel check, but my own report should be read as
no-independent-live-session due to local server binding restrictions.

## Placement judgment: app-local vs `packages/theme`

My independent opinion matches the first reviewer's conclusion: app-local
`apps/desktop/src/theme/` is the right boundary right now.

This is not just a convenience argument. `rendering.ts` is not a
brand-neutral design-token package waiting to be shared. Its values are
tied to the desktop scene: studio panel colors, GLB material names,
specific vehicle/emblem material tuning, Canvas starfield palette, and
fallback model behavior. A future mobile consumer would not naturally import
only this constants file; it would need the same rendering scene or a port of
that scene. The better future package boundary, if a second consumer appears,
is likely a shared vehicle/emblem scene package containing components,
assets, material tuning, and constants together. Extracting only
`packages/theme` now would create a prematurely generic boundary around
scene-coupled data.

`dom.ts` is even less portable: it documents CSS custom-property names from
the desktop app's `index.css`. A React Native/mobile UI would not consume
that layer directly. Keeping both files app-local is therefore not a
post-hoc excuse to avoid work; it is the more honest ownership boundary.

## Parallel `ws/car-data` merge analysis

I inspected `git diff main...ws/car-data` read-only.

The first reviewer's analysis is complete enough for the merge owner:

- Root `package.json` and `turbo.json` add the same `test` script/task on
  both branches. Those additions are byte-identical.
- `apps/desktop/package.json` will likely conflict textually. Correct
  resolution is the union: keep `"test": "vitest run"`, keep car-data's
  `"test:watch": "vitest"`, keep `vitest: "^4.1.11"`, and keep this branch's
  `@types/node: "^26.2.0"`.
- `pnpm-lock.yaml` should be regenerated after the merged manifests are
  resolved. Do not hand-merge it.
- car-data adds `apps/desktop/vitest.config.ts`; this branch does not.
  After both merge, Vitest will use car-data's config instead of falling
  back to `vite.config.ts`. I copied that config shape locally as a temporary
  file and ran `npx vitest run --config vitest.car-data.tmp.config.ts` from
  `apps/desktop`; this branch's theme tests still pass, 2 files / 8 tests.
  The temporary file was deleted afterward.

One practical merge note: after resolving both streams, force a fresh suite
run with `npx vitest run` inside `apps/desktop` or `turbo run test --force`.
Do not trust a root `pnpm test` result that may be Turbo cache replay.
