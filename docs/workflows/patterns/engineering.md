# Engineering patterns (all agents)

Hard-won rules from this repo's history. Violating one of these has
already cost real debugging time at least once.

1. Verify with a test, then claim — screenshots are the exception now, not
   the default. Changed 2026-08-21 (Alejandro: repeated live/manual
   verification across every build+review stage was burning real budget
   re-proving the same ground; manual testing is his job at the final
   gate, not every agent's job at every stage). See rule 11 for the
   testing setup. Reach for the connect-flow screenshot walkthrough
   (open localhost:1420, click Connect, wait about 15s, the discovery
   overlay appears, scroll down, click "Go to dashboard") only for
   something inherently visual a test can't check — layout, animation
   timing, 3D rendering, color — and say so explicitly rather than
   defaulting to it out of habit.
2. Typecheck constantly: `npx tsc --noEmit` after each meaningful change.
   Rust: `cargo check` in src-tauri when touched.
3. Mock parity: every Tauri command used by the frontend needs a matching
   case in src/lib/mock.ts, or the browser demo breaks silently — and a
   test asserting the two shapes match (rule 11), not just a manual check.
4. Same-name asset files are cached by the browser. When replacing a file
   in public/ keep the name only if you hard-reload during verification,
   otherwise use a new name. A stale cached asset once burned a whole
   debugging night.
5. No layout shifts. New UI states overlay (modal, fixed cover) or swap in
   place. Never insert banners that push content down.
6. Plain language in UI copy and docs: clear plain English, no em dashes,
   no decorative formatting. Spanish will follow via the i18n stream.
7. Isolation discipline: builders work in an explicit worktree on a
   ws/<stream> branch. Automatic agent isolation follows the wrong repo
   in this setup; do not rely on it.
8. Decision rationale goes inline (plan.md/research.md/commit messages),
   not a dedicated decisions-*.md file, except for something genuinely
   expensive to reverse or likely to be questioned without the reasoning
   in front of a reviewer (changed 2026-08-20 — see the Decision
   rationale section in researcher.md/planner.md/builder.md). An
   unexplained surprising choice found ANYWHERE in the diff still counts
   as a defect; the absence of a dedicated log file does not.
9. localStorage is for machine-local secrets and UI state (API key, last
   reports). SQLite is for car data. Never put secrets in SQLite: the DB
   gets exported wholesale into AI briefings.
10. The app is single-theme light by design. Do not add dark-mode
    variants.
11. Testing setup (added 2026-08-21, replaces most manual verification
    per rules 1/3 above). Vitest, colocated `*.test.ts` files. Priority
    order for what actually needs a test, highest-leverage first: (a)
    `mock.ts` parity — every command's mock response shape matches its
    real Tauri/Effect-Schema-decoded counterpart, this is the single
    thing every past review has manually re-verified; (b) the Schema
    decode boundary — malformed input rejected, valid input accepted,
    excess fields tolerated (the effect-architecture stream's review
    already worked out these exact cases by hand, turn them into tests
    instead of re-deriving them by hand next time); (c) any pure logic
    function (decodeDtc, buildVerdicts, the WMI lookup) — these need no
    running app at all to test and were previously "verified" only by
    reading the code. UI component rendering/interaction tests are lower
    priority than these three — the app has no component-test harness
    yet, don't build one speculatively, wait until a stream actually
    needs it. When reporting "tests pass," confirm the run actually
    executed and wasn't a Turborepo cache replay (`--force`, or run the
    package's own test command directly) — a cached-success report reads
    identical to a real one and defeats the whole point of this rule.
