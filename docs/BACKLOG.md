# Scainner product backlog

Working document for parallel development. Each workstream is independent
enough to be worked by a separate agent/session without stepping on the
others; the "files" line marks its blast radius so streams can run
concurrently.

## How we parallelize (process)

- One stream = one agent = one explicit file boundary. Streams whose file
  sets overlap do NOT run at the same time.
- Agents working this repo from an outside session must be given an
  explicit worktree: `git worktree add ../scainner-<stream> -b <stream>`
  (automatic worktree isolation follows the *session's* repo, which may not
  be this one — learned 2026-08-20).
- Nothing merges without `npx tsc --noEmit` clean and, when Rust changed,
  `cargo check` clean.
- ⚠️ The working tree currently carries the entire redesign uncommitted.
  Before branching streams, commit a checkpoint on main.

## Workstreams

## Design principles

- **No layout shifts.** State changes overlay or replace in place; they
  never push existing content around. (Connect→discovery flash fixed
  2026-08-20; the clear-codes confirmation banner still violates this.)
- **Plain language.** UI copy, docs, and reports use clear plain English:
  no em dashes, no decorative formatting. Spanish copy follows the same
  rule when i18n lands.
- **Honest absence.** When a car cannot provide a value (unsupported PID,
  unreachable module), the UI says so in one plain sentence. Silent
  hiding reads as a bug. First case: the C4 fuel gauge, 2026-08-20.

### A. Diagnostics UX (src/views/Diagnose.tsx, src/lib/meta.ts)
- [x] Clear-codes confirmation: replace the inline banner (pushes the whole
      page down — layout shift) with a modal in the style of the DTC detail
      modal (centered card, dimmed backdrop, optional blur). User sketch:
      full-screen modal, card in the middle, background darker/blurred.
- [x] Human-readable DTC descriptions — offline library (src/lib/dtc.ts):
      curated entries for ~30 common codes + structural decode for any code.
- [x] Per-code detail modal: meaning, severity, code anatomy, occurrence
      timeline, freeze frame, ranked causes/symptoms, per-code AI deep-dive.
- [ ] Persist AI reports in SQLite (`ai_reports` table + commands) instead
      of localStorage; list past reports with their trigger scan.
- [ ] Grow the DTC library from real-world encounters (unknown codes
      still get structural decode + AI).
- [ ] Surface "codes found" state on Overview's fault-record verdict with a
      one-click jump to Diagnose. (Verdict text exists; needs the link.)

### B. AI layer (src/lib/ai.ts, src-tauri)
- [ ] Streaming report generation (progressive render instead of spinner).
- [ ] Settings surface: API key + model choice move to a proper Settings
      view (key stays out of the DB — see ai.ts header for why).
- [ ] Report quality pass with a real faulty-car briefing once one exists.

### C. 3D identity (src/components/VehicleScene.tsx, src/lib/brand.ts)
- [x] Real modeled emblems: Volvo (hand-authored/SVG-traced, no STL
      supplied yet) and Audi, BMW, Citroen, Dacia, Fiat, Ford, Geely,
      Hyundai, Kia, Mercedes, Opel, Peugeot, Renault, Skoda, Toyota,
      Volkswagen (real STL geometry, supplied directly). Everything else
      still falls back to the chrome nameplate. New WMI gap closed: Geely
      (LB3); BYD/Chery still unmapped, fast-growing in Europe.
- [ ] Drag-to-rotate / scroll-to-zoom (OrbitControls) instead of spin-only.
- [ ] Decide fate of the dormant C4 car pipelines (GlbCarModel/StlCarModel/
      CarModel + repair script + model assets): keep one, delete the rest.

### D. Product/platform (src-tauri, packaging)
- [ ] Windows/macOS installers via release.yml (pattern exists in
      POS-Glop-Alt).
- [ ] First-run experience: empty-DB states audited end to end.
- [ ] App icon + name polish for distribution.

### H. Loading, state and performance (structural: touches every view)
- [ ] Proper loading states for every part of the app: skeletons per card,
      never a blank area, never a layout jump when data arrives.
- [ ] Incremental loading: render the shell immediately, stream data in
      per card; heavy pieces (three.js scene) arrive last without blocking
      the rest.
- [ ] Proper state management: today every view hand-rolls invoke +
      useEffect + useState with no cache, so data refetches on every tab
      switch and error states are inconsistent. Research server-state
      libraries (TanStack Query is the obvious candidate) wrapped around
      Tauri invoke, plus what if anything is needed for client state.
- [ ] Performance budget: no SSR exists (Vite + Tauri, not Next) and none
      is needed; the wins are fast first paint, cached data on
      navigation, code splitting, and asset weight. Audit bundle and
      startup time, set budgets, enforce in review.
      Note: sequencing versus stream F (i18n) matters; both restructure
      the views. Research can run in parallel; builds must be ordered.

### F. Internationalization (structural: touches every view)
- [ ] i18n system with English + Spanish. First testers are Spanish
      speakers in Spain, so Spanish is a launch requirement, not polish.
      This restructures how all UI strings live. Run it through the FULL
      pipeline (research: library choice for React+Tauri, string
      extraction strategy, AI-report language; plan needs the user gate
      before any build). Large file boundary: coordinate so no other
      stream runs concurrently over the views.

### G. Write capabilities (product differentiator, safety-critical)
- [ ] The product vision is read AND write: not just showing faults but
      fixing what can be fixed from the ECU side. Today we clear codes.
      Next candidates, in rising risk order: UDS routine control and
      actuator tests, adaptation resets, service functions.
      Research stream first: what STN2100-class Bluetooth hardware can
      safely do (PSA first, then generally), what competitors ship
      (OBDeleven, Carly, Launch, Autel), and the safety rail design.
      HARD RULE: every write action gets an explicit confirmation, a
      logged before/after state, and a documented reversal path. No write
      ships without all three.

### E. Fleet realism (mock + real hardware)
- [ ] Second-car test: any non-Citroën VIN exercises the nameplate emblem
      fallback and multi-car report_cars paths.
- [ ] Demo scenario switcher (clean car / faulty car / new car) instead of
      one hardcoded story.

## Done log

- 2026-08-20: theme locked to light everywhere (page + native + Tauri
  window); connect→discovery flash fixed; brand-emblem 3D scene from VIN
  WMI (Citroën chevrons + nameplate fallback); AI diagnosis card in
  Diagnose (user's own Anthropic key, localStorage-only); demo DTC story in
  mock (stateful scan/clear, P0420+P0301, freeze frame); dead body-color
  plumbing removed (agent-executed, tsc+cargo clean).
