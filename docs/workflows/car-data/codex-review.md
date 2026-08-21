# Codex cross-review: car-data WMI dataset + Vitest setup

Reviewer: Codex, 2026-08-21. Reviewed current `HEAD` against
`main...HEAD` in `/Users/cxalem/projects/scainner-car-data`.

## Verdict: SHIP

I found no blocking defects. The WMI migration is mechanically lossless for
carried-over entries, the six additions match the plan/audit, the first
reviewer's two claimed fixes are present, and the test suite executes cleanly
when forced past Turbo cache replay.

## Verification performed

- Read, in order requested: `docs/workflows/roles/reviewer.md`,
  `docs/workflows/patterns/engineering.md` rule 11,
  `docs/workflows/car-data/plan.md`,
  `docs/workflows/3d-logos/wmi-audit.md`, and then
  `docs/workflows/car-data/review-report.md`.
- Ran `git log --oneline main..HEAD`. This branch currently has 3 commits,
  not 4:
  - `54724ad review(car-data): key-format test guard, accurate confidence gloss, review report`
  - `51ed08a test(car-data): add Vitest, first real test infra in the repo`
  - `a002c01 feat(car-data): move WMI table to data/wmi.json, fold in audit additions`
- Inspected `git diff main...HEAD`. Touched files are limited to frontend
  package/test/data wiring plus `review-report.md`; no `src-tauri` paths.
- Ran `pnpm install`: already up to date.
- Tried `pnpm exec vitest run --force` inside `apps/desktop`; Vitest 4.1.11
  rejects `--force` as an unknown option. Then ran the direct non-Turbo command
  `pnpm exec vitest run` inside `apps/desktop`, which is still a real execution
  rather than a Turbo replay: 1 test file, 13 tests passed, duration 102ms.
- Ran `pnpm test --force` at repo root to exercise the intended Turbo escape
  hatch: `@scainner/desktop:test: cache bypass, force executing`, 1 test file,
  13 tests passed, duration 91ms. Turbo emitted `WARNING IO error: Operation
  not permitted (os error 1)` after success, but exited 0.
- Ran `pnpm typecheck`: all 3 package typecheck tasks successful. Desktop was
  a cache miss; core/mobile were cache hits.

## Migration check

I independently compared `main:apps/desktop/src/lib/brand.ts` against
`apps/desktop/src/data/wmi.json` with a small Node script extracting the old
inline WMI object.

Result:

- Old inline table: 53 entries.
- New JSON table: 59 entries.
- Dropped carried-over entries: none.
- Changed carried-over `key`/`name` pairs: none.
- Added entries: exactly `7G2`, `7SA`, `LVY`, `SHS`, `SJK`, `WA1`.
- Malformed new JSON keys: none.

That verifies the first reviewer's lossless-migration claim.

## Claimed fixes

The malformed-key guard is present in `apps/desktop/src/lib/brand.test.ts`.
The real-data test now asserts every raw `wmi.json` key matches
`/^[A-Z0-9]{3}$/`, which catches unreachable keys like `VR7 `, `AB`, `ABCD`,
or the empty string. The parser itself remains tolerant, so this is a
test-time data integrity guard, not runtime rejection. For this app-local JSON
asset, that is acceptable.

The `brand.ts` header comment no longer claims every `high` confidence row is
NHTSA-confirmed. It now explicitly includes three-plus convergent secondary
sources for brands NHTSA cannot cover, naming examples like VF7, UU1, and TMB.
That matches the audit's grading logic.

## Public behavior

`brandFromVin` keeps the same public signature:
`(vin: string | null | undefined) => BrandInfo | null`. Its observable lookup
behavior remains the same: first three characters, uppercase normalization,
unknown/short/null inputs return `null`, no throw.

The actual call sites are:

- `apps/desktop/src/components/DiscoveryFlow.tsx`: calls `brandFromVin(vin)`
  for display metadata during discovery results.
- `apps/desktop/src/components/VehicleScene.tsx`: memoizes
  `brandFromVin(vin)` and uses only `brand.key` for emblem selection and
  `brand.name` for the fallback nameplate.

The added `confidence` and `source` fields are additive and do not change those
call sites.

## src-tauri

Confirmed untouched. Both `git diff -- apps/desktop/src-tauri` and
`git diff main...HEAD -- apps/desktop/src-tauri` are empty.

## packages/data vs app-local

The monorepo plan quote is real. It says `packages/data` is "the car reference
dataset ... shared by both apps", and separately says `packages/ui` is "NOT
assumed cross-platform-shareable" because Tauri/web and React Native have
different component primitives, "until proven otherwise."

My opinion: keeping `wmi.json` app-local for this pass is the right call, but
only narrowly. Reference data is more naturally shareable than UI components:
it has no platform-specific rendering primitives and should eventually live in
`packages/data` once mobile actually consumes vehicle identity. But today
`apps/mobile` is an empty Expo shell with no car-data call site. Extracting a
shared package now would add package/export/JSON-resolution surface area
without proving the second consumer. The current move is easy to reverse later:
one JSON file and one thin lookup module. I would not block on this.

## Test setup precedent

This is a good first testing template for future streams: colocated
`*.test.ts`, a small package-local Vitest config, pure-logic tests that require
no running Tauri/browser app, and a real-data test that treats the JSON asset
as production input.

Gaps to flag before teams copy it blindly:

- The Turbo cache replay trap is real. A reviewer should use `pnpm test
  --force` or run `pnpm exec vitest run` directly inside the package. The
  current `docs/workflows/roles/reviewer.md` in this checkout does not contain
  the "freshly-added" cache warning mentioned in the prompt, so that process
  warning still needs to land somewhere durable.
- This setup covers pure logic only. Future component tests will need a DOM
  environment choice, and future Effect/mock work still needs rule 11(a)/(b)
  tests for mock parity and schema decode boundaries.
- The real-data key assertion should be copied for future data files: validate
  keys as well as values.

No objections blocking ship.
