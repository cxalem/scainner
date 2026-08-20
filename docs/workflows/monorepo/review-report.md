# Review report: monorepo, stage 4

Reviewer: Claude (Fable 5), 2026-08-21. Branch `ws/monorepo` at d4cdc90
plus this review's fix commit, reviewed in the worktree
`/Users/cxalem/projects/scainner-monorepo` against `main...ws/monorepo`
(3 commits, 148 files, +5700/-775 — the overwhelming bulk pure renames
at 89-100% similarity).

## Verdict: ship, with the small fixes made in this review

The move is real and verified end to end by me, not inherited from the
builder's claims: a full `pnpm tauri build` from `apps/desktop` produced
a genuine `Scainner.app` and `Scainner_0.1.0_aarch64.dmg` in this review
session; tsc is clean in all three packages; `cargo check` is clean; the
turbo task graph executes for real (forced past the cache); a frozen-
lockfile install passes; and a live browser session of the full app flow
from the new location (connect gate → discovery overlay → dashboard, 3D
scene assets included) ran with zero console errors. Every strong claim
in the commit messages reproduced. What I found and fixed is a class of
small post-move staleness the builder did not sweep for: the public
README still documented the pre-move layout, the root `.gitignore`'s
anchored `public/models-preview/` rule silently stopped covering the
moved directory, `brand.md` pointed at the old CSS path, and the
supply-chain allowlist added to `pnpm-workspace.yaml` was explained
nowhere (engineering pattern 8). All fixed; nothing needed rework.

## Scope check

Diff touches: the new root `package.json` / `pnpm-workspace.yaml` /
`turbo.json`; the wholesale rename of the app into `apps/desktop`
(src, src-tauri, public, index.html, vite.config.ts, tsconfig*, plus
`scripts/repair-c4-glb.mjs`); the `packages/core` extraction (errors,
six schema files, AiService whole, DeviceService Tag-only, new
`device-service-live.ts` in desktop, 16+ mechanical import-path swaps);
the `apps/mobile` Expo scaffold; and the lockfile.

Boundary respected: zero Rust changes (`apps/desktop/src-tauri` is a
pure rename; `cargo check` run anyway, clean). `tauri.conf.json`,
`vite.config.ts`, and `tsconfig.json` are all 100%-similarity renames —
no sneaky config edits hiding inside the move. `scripts/
pipeline-status.mjs` stayed at root as claimed, and I ran it: it renders
every stream correctly from the new root (it only reads
`docs/workflows/**` and git branches — genuinely app-path-independent).
`packages/data` and `packages/ui` were not created — correct, the plan
gates data on the car-data stream and scopes ui to "not until proven".
No CI config exists (no `.github/`), so nothing there to go stale. No
scope creep found.

## Independent verification (mine, not the builder's)

**The "no tauri.conf.json changes needed" claim.** True, and I checked
it the hard way. `git diff -M` shows `tauri.conf.json` as a
100%-similarity rename — zero content change. Its only relative path
(`frontendDist: "../dist"`) resolves against `src-tauri`'s own location,
and src-tauri moved as a unit with its frontend parent, so the relative
structure is identical. The empirical proof: I ran `pnpm tauri build`
from `apps/desktop` myself — release cargo build finished, and both
bundles were produced at
`apps/desktop/src-tauri/target/release/bundle/{macos/Scainner.app,
dmg/Scainner_0.1.0_aarch64.dmg}`. The `beforeDevCommand`/
`beforeBuildCommand` (`pnpm dev`/`pnpm build`) resolve against
`apps/desktop/package.json`, which kept the original vite scripts — the
root's new turbo-wrapping scripts never intercept them.

**Typecheck / Rust / task graph.** `npx tsc --noEmit` run directly in
`packages/core`, `apps/desktop`, and `apps/mobile`: all clean. `cargo
check` in `apps/desktop/src-tauri`: clean. `pnpm turbo run typecheck`
and `pnpm turbo run build` from root initially replayed the builder's
cache (which proves nothing), so I re-ran both with `--force`: 3/3
typecheck tasks and 2/2 build tasks (desktop vite build + mobile `expo
export`) genuinely executed and passed. `packages/core` has no build
task by design (source-only package, `main`/`types` point at
`src/index.ts`) — turbo's `^build` dependency handles the absence
correctly.

**Lockfile integrity.** `pnpm install --frozen-lockfile` passes
("Lockfile is up to date, resolution step is skipped") — a CI-style
install will not break. A plain `pnpm install` emits zero peer or other
warnings. After the install reshuffled node_modules I re-forced
typecheck and build: still green.

**The core extraction boundary (the actual point).** Grep of
`packages/core/src` for `tauri`, `@tauri-apps`, `window.`, and any
app-relative `@/` import: zero hits. Each schema file imports only
`effect` (five moved at 100% similarity, i.e. byte-identical).
`ai-service.ts` moved at 98% similarity — the single change is the
import path `@/core/errors` → `../errors`. The DeviceService Tag in
core declares the identical 31-method interface as the pre-move file
(compared side by side), with all Tauri coupling stripped to
type-only imports of core's own schemas. Core's `package.json` depends
only on `effect`. The swappability property holds: a mobile transport
can implement the Tag without pulling in anything Tauri-shaped.

**device-service-live.ts behavior parity.** I diffed the new
`apps/desktop/src/core/services/device-service-live.ts` against main's
`src/core/services/device-service.ts` implementation half,
method by method: all 31 method bodies are line-identical (same
commands, same args, same `Schema.mutable(Schema.Array(...))`/`NullOr`
decode wrappers, same baked `confirmed: true` on the two writes —
unchanged from what the effect-architecture review already flagged as
its finding 5). The `call`/`decoded` helpers moved verbatim.
`runtime.ts` changed only its two imports (`AiServiceLive` from
`@scainner/core`, `DeviceServiceLive` from the new live file); the
`Layer.mergeAll` composition is untouched. Live proof below.

**The "matches a pre-existing comment" claim — checked verbatim, not
trusted.** Main's `src/core/services/device-service.ts` header really
does say: "Swapping `DeviceServiceLive` (Tauri) for a future transport
(mobile BLE bridge, Supabase) changes this one file, not every call
site (research.md section 5)." The commit's elided quote reproduces
this accurately, meaning intact. The split implements exactly that:
contract shared, one Tauri file left behind. Not a fabricated quote.

**App flow from the new location.** Full headless-browser session
against `pnpm dev` in `apps/desktop` (mock mode, port 1420): connect
gate renders → Connect → ~15s discovery → overlay appears with vehicle
identity, 3D Citroën logo scene (so the moved `public/` assets load),
protocol/sensor/DTC summary → "Go to dashboard" → Overview with health
verdicts, sidebar, connection card. **Zero console errors, zero page
errors.** Screenshots taken in this review session.

**apps/mobile is genuinely minimal.** `App.tsx` is Expo's literal
blank-typescript starter screen ("Open up App.tsx to start working on
your app!"), `index.ts` is the stock `registerRootComponent` stub,
`app.json` is template config with no plugins. Zero OBD2/BLE/transport
code, no premature dependencies beyond what `expo export` itself
requires (react-dom + react-native-web, which the commit explains). It
builds for real: `expo export` produced bundles via the forced turbo
run in this session. It does not import `@scainner/core` yet — correct
for an empty shell, but see finding 5.

**The flagged react peer mismatch.** Not reproducible at HEAD.
`pnpm ls -r`: desktop resolves react@19.2.8 + react-dom@19.2.8
(self-consistent, both from `^19.1.0`); mobile pins 19.2.3 + 19.2.3
(Expo SDK 57's requirement, self-consistent). pnpm keeps the two
version sets fully isolated per app, and a current `pnpm install`
prints no peer warnings at all. Whatever transient state the builder's
`pnpm peers check` saw mid-migration, the settled lockfile does not
have it. Genuinely harmless as claimed — arguably already gone. The
builder's suggested follow-up (pin desktop's react to an exact version
like mobile does, so desktop doesn't silently float across react
patches) is still reasonable hygiene, but nothing blocks on it.

## Findings, ranked (1-4 fixed in this review's commit)

1. **Public README still documented the pre-move repo (fixed).** This
   repo is public on GitHub; after the move, `pnpm tauri dev` from the
   root (the README's literal "Running it" instructions) fails — the
   root package.json no longer has a `tauri` script — and every
   architecture path (`src-tauri/src/`, `src/views/`,
   `src-tauri/src/elm/*.rs`, `cd src-tauri && cargo test`) pointed at
   directories that no longer exist. The README also still said shared
   types live in `src/lib/meta.ts`, a file the effect stream deleted
   (pre-existing staleness, but this stream moved the tree it described,
   so it got fixed here rather than punted again). Fixed: added a short
   Repository-layout section, prefixed all paths with `apps/desktop/`,
   corrected the run/test instructions to the new locations, described
   the packages/core split. Any external clone following the README
   before this fix hits an immediate dead end — this was the most
   user-visible defect in the stream.
2. **Root `.gitignore`'s `public/models-preview/` rule silently stopped
   working (fixed).** A slash-containing gitignore pattern anchors to
   the .gitignore's own directory, so after the move the rule matched
   nothing — the 29MB local-only STL directory the rule exists to keep
   out of the repo would have shown up as committable the moment a dev
   recreated it under `apps/desktop/public/`. Fixed to
   `apps/desktop/public/models-preview/` and verified with
   `git check-ignore` against a probe file. Also added `.turbo/`
   (turbo's per-package run-log directories; only `*.log` files today,
   caught incidentally by the log rule, but the directory pattern is
   the correct guard). This is exactly the "breaks in ways that only
   show up later" class this stream was flagged for.
3. **`minimumReleaseAgeExclude` in pnpm-workspace.yaml was explained
   nowhere (fixed).** Twelve exact-pinned Expo package versions were
   allowlisted past pnpm's supply-chain release-age gate in the mobile
   commit, with no mention in any commit message — an unlogged
   surprising choice in a security-relevant setting (engineering
   pattern 8). The change itself is legitimate (freshly released SDK 57
   packages cannot install otherwise), but the next person to bump Expo
   would have no idea why installs fail or what this list is. Fixed
   with an explanatory comment including the maintenance rule (extend
   on Expo bumps, remove once aged past the gate). Codex question 2.
4. **brand.md pointed at the old `src/index.css` path (fixed).**
   One-line fix to `apps/desktop/src/index.css`. (BACKLOG.md's old-path
   mentions sit inside dated historical "done" entries and were left
   as history.)
5. **Info, not fixed: `packages/core`-via-Metro is unproven.** Core is
   consumed as raw workspace TS source (`main: ./src/index.ts`). Vite
   and tsc handle that today — verified. The mobile app, the package's
   entire reason to exist, does not import it yet, so the
   Metro/Expo-side story (transpiling a workspace TS source package)
   is untested in this repo. Expo SDK 55+ advertises first-class
   monorepo support and this is the standard shape, but the first
   mobile commit that imports `@scainner/core` should treat "it
   bundles through Metro" as a real verification step, not an
   assumption. Codex question 1.
6. **Info: `pnpm dev` at the root starts both apps.** Root `dev` runs
   `turbo run dev`, which launches desktop's vite AND mobile's
   `expo start` together as persistent tasks. Standard turbo behavior,
   but a dev wanting only the desktop app should run it from
   `apps/desktop` (which the fixed README now says). Worth one line in
   a future contributing doc; not a defect.
7. **Info: core's tsconfig lib includes "DOM" for `fetch` typing.**
   Disclosed in the commit message. Type-level only, and React Native
   provides `fetch` at runtime, so it does not undermine the
   transport-agnostic claim — but it does let DOM globals type-check
   inside core silently. A stricter alternative if it ever bites:
   drop "DOM" and declare the two fetch types core needs.
8. **Info: no `status.json` for this stream** — consistent with
   effect-architecture; assumed orchestrator-owned.

## Claims-vs-evidence audit (the fabricated-quote check)

- "No tauri.conf.json path changes were needed... Confirmed by running
  the real thing" (a38aa6f) — true; 100%-similarity rename plus my own
  successful `.app`/`.dmg` build this session.
- "pnpm tauri build: full release build succeeds, produces Scainner.app
  and Scainner_0.1.0_aarch64.dmg" (a38aa6f) — reproduced independently.
- The DeviceService header quote (0fd0f2e) — real, verbatim on main,
  accurately elided. Not a repeat of the fabricated-plan-quote
  incident.
- "Every change here is a path swap, not a logic change" (0fd0f2e) —
  true for every file I compared (all six schema files byte-identical;
  ai-service one import line; live layer method bodies line-identical;
  runtime.ts imports only).
- "The alternative would make packages/core depend backward on
  apps/desktop's src/features/*" (0fd0f2e) — correct: the Tag's method
  signatures reference CarReport/DtcResult/etc., so the schemas had to
  move with the contract. The messier-than-planned extraction is
  honestly narrated and the design call is right.
- Mobile verification block (d4cdc90) — tsc/export/turbo claims all
  reproduced; the peer-mismatch disclosure was accurate about install
  and builds succeeding, and the mismatch itself has since settled out
  entirely (see above).
- "scripts/pipeline-status.mjs stays at repo root — it reads
  docs/workflows/** and git branches repo-wide, not app-specific"
  (a38aa6f) — verified by reading it and running it: correct on both
  counts.

## Fixes made in this review (committed on this branch)

One commit: README post-move corrections (layout section, all paths,
run/test instructions), `.gitignore` re-anchoring of
`apps/desktop/public/models-preview/` plus `.turbo/`, the
pnpm-workspace.yaml allowlist explanation, brand.md path fix, and this
report. Verified after: `git check-ignore` probes pass, forced
`turbo run typecheck` 3/3 clean (doc/config-comment changes touch no
code; the earlier full-build/bundle/browser evidence in this report
already post-dates every code-affecting state on the branch).

## Questions for the Codex cross-exam

1. **Metro consumption of `packages/core` (finding 5).** Should the
   stream that first imports `@scainner/core` from mobile be required
   to prove the Metro bundle as its first commit, or is Expo SDK 55+
   monorepo support trusted until it breaks?
2. **The supply-chain allowlist (finding 3).** Is exact-pinning twelve
   Expo packages past the release-age gate acceptable as a standing
   exception, or should it be time-boxed (e.g. removed at the next
   Expo bump once versions age past the gate)? Who owns remembering?
3. **Desktop's floating react range.** Desktop floats `^19.1.0` (today
   19.2.8) while mobile pins exact per Expo. Align desktop to exact
   pins for reproducibility, or is the lockfile guarantee enough?
4. **Root-level DX.** Is `pnpm dev` starting both apps (finding 6)
   acceptable, or should root scripts use turbo filters
   (`turbo run dev --filter=@scainner/desktop`) with an explicit
   `dev:all`?

## Gut check for the human

Would I trust distributing the app from this structure today: yes,
without reservation for the desktop app — the artifact I would ship is
one I watched build from scratch in this session, from the new paths,
with the frontend flow exercised live and zero behavioral diff found
anywhere in the moved code. The move is the rare kind that is actually
as clean as claimed; the defects were all in the documentation shell
around it, and are fixed. The honest remaining doubt is not the desktop
app but the other half of the monorepo's promise: `packages/core` has
never been consumed by anything except the app it was extracted from,
and its first real test — Metro bundling it into the Expo app, and a
second DeviceService implementation actually satisfying the Tag — is
still in the future. That is by design (the plan explicitly scopes
mobile features out), but until a second consumer exists, "the
extraction boundary is right" rests on inspection rather than proof.
The MX+ transport question the plan itself calls "the real first task"
is also still open, and nothing in this stream advanced it — fine per
scope, but it means tomorrow's mobile work starts with the hard
question, not with this scaffold.
