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

## Priority order (2026-08-25) — supersedes the 2026-08-21 order below

The alpha queue. Full specification in
`docs/product/vehicle-interaction-architecture.md`. The 2026-08-21 order
below is kept for its reasoning but is largely spent: I (Effect) and J
(monorepo) have both landed.

1. **Clear-codes correctness (N)** — first, and ahead of everything
   architectural. Clearing codes is broken on every car, the root cause is
   found and reproduced by test, and the negative-response decoder it
   introduces is a prerequisite for every service function that follows.
2. **Operations ledger (O)** — depends on N's decoded outcome shape. The
   raw-byte capture it adds is what would have made N's bug visible months
   ago instead of invisible.
3. **Capability model and pack schema (P)** — the structural centre. Touches
   the UDS engine and both knowledge APIs; nothing else should be mid-flight
   in `elm/` when it lands.
4. **Pack distribution (Q)** — depends on P. Until this ships, every
   learning is trapped behind a full app release.
5. **Reports (R)** — depends on O for evidence links. Can run in parallel
   with Q (different files).
6. **Learning loop (S)** — depends on O and Q.
7. **Authorization (T)** and **service functions (U)** — post-alpha, gated
   as described in their entries.

Diagnose/codes UX redesign (A) and the AI agent stream remain real and
unblocked; they can run alongside the queue above since they do not touch
`elm/`.

## Priority order (2026-08-21)

Architectural streams first, deliberately — anything that touches most of
`src/` goes before feature work, because doing them in the other order
means every feature stream built in between becomes a merge conflict once
the architectural change lands. This ordering is the actual answer to
"what do we work on next," re-check it here before starting anything new
rather than picking from the section list below by feel.

1. **Effect migration (I)** — in review, Codex cross-exam running. Bundle
   size tradeoff (+58KB gzip) explicitly accepted. Next: merge once Codex
   clears.
2. **Monorepo + Turborepo scaffold (J)** — next after I merges. Moves
   every file into `apps/desktop`; nothing else should be mid-flight in
   `src/` when this happens.
3. **Car reference data (K)** and **design tokens (L)** — both small,
   mechanical, fast once I and J are in. Can run in either order or in
   parallel with each other (they don't share files).
4. **Animation system (M)** — after L, since it's easiest to define the
   shared motion vocabulary once the token/theme structure it might
   reference (transition durations, etc.) is settled, and because it
   touches nearly every view (same conflict-avoidance logic as I/J).
5. **Diagnose/codes UX redesign (A, expanded)** and the **AI agent**
   stream — real feature work, start once the architectural queue above
   is clear. These can run in parallel with each other if genuinely
   needed (different views), but not with 1-4.
6. Everything else in the section list below (write-caps increment 2,
   fleet realism, product/platform packaging, AI layer polish) — pick up
   opportunistically, none of it blocks or is blocked by 1-5.

## Workstreams

## Design principles

- **No layout shifts.** State changes overlay or replace in place; they
  never push existing content around. (Connect→discovery flash fixed
  2026-08-20; both clear-codes confirmation banners are now the shared
  ConfirmWrite overlay modal, ws/write-caps 2026-08-20.)
- **Plain language.** UI copy, docs, and reports use clear plain English:
  no em dashes, no decorative formatting. Spanish copy follows the same
  rule when i18n lands.
- **Honest absence.** When a car cannot provide a value (unsupported PID,
  unreachable module), the UI says so in one plain sentence. Silent
  hiding reads as a bug. First case: the C4 fuel gauge, 2026-08-20.

### A. Diagnostics UX (src/views/Diagnose.tsx, src/lib/meta.ts)
- [ ] Real code-scanner redesign, gated on the priority queue above.
      Trigger: Alejandro's own car threw 86 codes from one battery
      issue — today's flat wrapped-badge list is unusable at that scale.
      Research complete: docs/workflows/diagnose-ux/research.md. Top
      finding: no car diagnostic tool, consumer or shop-grade, does
      root-cause clustering, despite GM holding patents on exactly this
      problem — real prior art exists instead in alert-monitoring tools
      (PagerDuty/Datadog/Sentry). Recommended direction: system-grouped
      flat list (free from dtc.ts's decodeDtc() taxonomy) collapsing
      past a size threshold, severity-colored, one honest low-voltage
      clustering hint. DtcDetailModal stays as-is. Needs a planning pass
      before build.
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
- [x] Sensor list scrollbar layout shift in DiscoveryFlow (overflow-y-auto
      to overflow-y-scroll, gutter now reserved either way).
- [x] Emblem showing the wrong (generic) brand briefly on connect, fixed at
      the root cause: Overview now receives the VIN as a prop from App
      (known earlier) instead of re-fetching it independently and racing
      the "connecting" animation.
- [x] Model year decode from the VIN (src/lib/vin.ts, ISO 3779 position 10,
      offline, universal) — surfaced in Overview's header and
      DiscoveryFlow's new "Vehicle" row. Full model/trim decode was
      investigated and is NOT done: no free, comprehensive source exists
      for European-market brands (checked directly against NHTSA's VIN
      decoder — works for US-sold brands, fails outright for this app's
      own reference car, a Citroen). See src/lib/vin.ts header and
      docs/workflows/3d-logos/decisions-build.md addendum 3 for the
      evidence and the options if this gets picked up later.

### B. AI layer (src/lib/ai.ts, src-tauri)
- [ ] Streaming report generation (progressive render instead of spinner).
- [ ] Settings surface: API key + model choice move to a proper Settings
      view (key stays out of the DB — see ai.ts header for why).
- [ ] Report quality pass with a real faulty-car briefing once one exists.

### C. 3D identity (src/components/VehicleScene.tsx, src/lib/brand.ts)
- [x] Real modeled emblems: Volvo (hand-authored/SVG-traced, no STL
      supplied yet) and Audi, BMW, BYD, Chery, Citroen, Dacia, Fiat, Ford,
      Geely, Hyundai, Kia, Mercedes, Opel, Peugeot, Renault, SAIC, Seat,
      Skoda, Tesla, Toyota, Vauxhall, Volkswagen (real STL geometry,
      supplied directly). Everything else still falls back to the chrome
      nameplate. New WMI gaps closed: Geely (LB3, high confidence), BYD
      (LGX, confirmed against NHTSA's registry), Chery (LVV, medium
      confidence, two secondary sources). SAIC and Vauxhall deliberately
      have no WMI: SAIC doesn't retail under its own name (badges as
      MG/Roewe/Maxus instead), Vauxhall shares Opel's W0L with no reliable
      way to tell them apart — both reachable via dev override only.
- [x] Dark card background with slow drifting particles behind the badge
      (EmblemStarfield.tsx, adapted from the knowledge-base starfield
      note), replacing the flat light card.
- [x] Real 3D GLB geometry (rounded torus rings, true depth/fillets, a
      step up from flat-extruded STL) for Audi, BMW, Mercedes, Toyota, VW.
      Adds ~15.7MB to the bundle for these 5 brands alone (~25MB total
      emblem payload) — candidate for mesh decimation before more brands
      move to this pipeline at full CAD tessellation.
- [ ] Drag-to-rotate / scroll-to-zoom (OrbitControls) instead of spin-only.
- [ ] Decide fate of the dormant C4 car pipelines (GlbCarModel/StlCarModel/
      CarModel + repair script + model assets): keep one, delete the rest.

### D. Product/platform (src-tauri, packaging)
- [x] macOS installer + auto-updater via release.yml (2026-08-21,
      ws/updater): `tauri-plugin-updater` wired up (silent, offline-safe
      check — see `components/UpdateBanner.tsx`), signing keypair
      generated and registered as repo secrets, `.github/workflows/
      release.yml` builds a universal (Apple Silicon + Intel) bundle on a
      version-tag push and drafts a GitHub release (not auto-published —
      a human still has to click Publish before it ships to real
      installs). Windows installer explicitly not in this pass — see
      backlog item 6 in the repo root `BACKLOG.md`, same macOS-only
      scoping as before.
- [ ] Apple notarization — today's builds are ad-hoc-signed only, so a
      downloaded copy hits Gatekeeper's "unidentified developer" warning
      on first launch (workaround: right-click → Open). Real notarization
      needs a paid Apple Developer Program membership ($99/yr) and
      Developer ID Application/Installer certs, neither of which exist
      yet — flagged rather than silently assumed done. `release.yml`'s
      own release notes already say this explicitly so it doesn't read
      as a bug.
- [ ] First-run experience: empty-DB states audited end to end.
- [ ] App icon + name polish for distribution.

### H. Loading, state and performance (structural: touches every view)
- [ ] Proper loading states for every part of the app: skeletons per card,
      never a blank area, never a layout jump when data arrives.
- [ ] Incremental loading: render the shell immediately, stream data in
      per card; heavy pieces (three.js scene) arrive last without blocking
      the rest.
- [x] Proper state management (2026-08-20, ws/app-perf, PR #3 merged):
      every view migrated to TanStack Query. Tab switches render
      instantly from cache instead of refetching from blank; consistent
      pending/error/skeleton states via shared hooks. Superseded by the
      Effect migration's Layer-wrapped queries (ws/effect-architecture,
      in review) but the caching behavior itself is unchanged.
- [ ] Performance budget: no SSR exists (Vite + Tauri, not Next) and none
      is needed; the wins are fast first paint, cached data on
      navigation, code splitting, and asset weight. Audit bundle and
      startup time, set budgets, enforce in review.
      Note: sequencing versus stream F (i18n) matters; both restructure
      the views. Research can run in parallel; builds must be ordered.

### F. Internationalization (structural: touches every view)
- [x] i18n system with English + Spanish (2026-08-21, ws/i18n +
      ws/i18n-phase2, PRs #10-#12 merged): typed dictionary (`en.ts`/
      `es.ts`, `tsc` fails on a key missing from either locale),
      `useT()`/`useLocale()`, locale toggle in Shell's sidebar, every
      view and shared component translated including the DTC library
      content and AI-report language. Full status: `docs/workflows/i18n/
      status.json`. Still open, not blocking: a native Spanish
      speaker (ideally a mechanic) reviewing the automotive terminology
      before it's fully trusted, and Phase 5 (backend/Rust strings —
      OS notifications, PID label sourcing, raw error strings),
      explicitly deferred per `docs/workflows/i18n/plan.md`.

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
- [x] Increment 1 (2026-08-20, ws/write-caps): the safety rail itself,
      wired to the two existing real writes. writes_log audit table +
      Write history card, shared ConfirmWrite modal (reversal text
      required), confirmed flag enforced at the command boundary,
      backend-verified engine clear. No new-to-the-car writes yet.
- [ ] Increment 2: routine-ID hunt session with the real car (engine/ABS),
      then the first actuator test behind the same rail (hard timeout +
      auto-revert). See docs/workflows/write-caps/plan.md.

### E. Fleet realism (mock + real hardware)
- [ ] Second-car test: any non-Citroën VIN exercises the nameplate emblem
      fallback and multi-car report_cars paths.
- [ ] Demo scenario switcher (clean car / faulty car / new car) instead of
      one hardcoded story.

### I. Architecture: Effect migration (structural, touches every view)
- [x] Full migration to Effect (effect.website) across the TypeScript
      frontend: DeviceService/AiService behind Context.Tag Layers, Effect
      Schema replacing plain types at every invoke() boundary, feature-based
      folder restructure (src/core, src/features/<name>), component-size
      cleanup (Diagnose.tsx/Overview.tsx split into one-file-per-component).
      Rust untouched — Effect is TS-only, Rust already has Result<T,E>.
      2026-08-20/21, ws/effect-architecture. See
      docs/workflows/effect-architecture/{research,plan}.md. In review.

### J. Monorepo + mobile app start (gated on I landing and clearing review)
- [ ] Turborepo + pnpm workspace scaffold: apps/desktop (today's Tauri app,
      moved with zero behavior change), apps/mobile (new Expo app),
      packages/core (Effect DeviceService/AiService/Schema layer, lifted
      from src/core once I lands), packages/data (see K below).
- [ ] MX+ transport spike, the real first task, before any app code: the
      OBDLink MX+ (hardware already ordered) is MFi-certified Bluetooth
      Classic SPP on iOS, not BLE — it routes through Apple's
      ExternalAccessory framework. Standard React Native BLE libraries
      (react-native-ble-plx, react-native-ble-manager) cannot see or
      connect to it at all on iOS. The current dev dongle (vGate iCar Pro)
      is dual-mode and will mask this gap in early testing. Confirm
      whether Expo's managed workflow can reach ExternalAccessory (it
      cannot natively — needs a config plugin or bare workflow with real
      Swift) and the Android-side classic-SPP library choice, before
      scoping any mobile feature work. Not gated on I — can start now if
      wanted, independent of everything else in this section.
      See docs/workflows/monorepo/plan.md.

### K. Centralized car reference data (gated on I landing and clearing review)
- [ ] Move src/lib/brand.ts's inline WMI table into data/wmi.json, keeping
      the confidence/source metadata the 2026-08-20 audit
      (docs/workflows/3d-logos/wmi-audit.md) already produced per entry,
      not just key/name. brandFromVin becomes a thin lookup over the JSON,
      not a rewrite.
- [ ] Fold in the audit's strongest "worth considering" additions, each on
      its own merit: SJK/SHS (Nissan/Honda UK), LVY (Volvo China), 7G2/7SA
      (Tesla Austin), WA1 (Audi SUV line).
      This is reference data (static, identical across every install), not
      operational data (a specific car's readings/DTC history, which stays
      in SQLite) — deliberately not the same question as Supabase. No live
      database for this in this pass; revisit once apps/mobile (J above)
      is real and needs to consume the same dataset without a rebuild.
      See docs/workflows/car-data/plan.md.

### L. Shared design tokens (gated on I and J landing)
- [ ] The DOM/CSS layer is already correctly done — checked directly,
      not assumed: src/index.css is the single source of truth (CSS
      custom properties + Tailwind v4 @theme inline), every component
      consumes via bg-primary/text-primary classes, zero hardcoded hex
      anywhere in a component's className. Changing the brand green
      today is already a one-line edit. The real gap: 25 hardcoded hex
      values exist, all in the 3D/Canvas layer (VehicleScene.tsx,
      emblems.tsx, EmblemStarfield.tsx) — chrome material and studio
      lighting constants Three.js needs as raw values, not CSS
      variables. Plan: a src/theme/ module as the documented single
      source, migrating the 3D files to import from it (pixel-identical
      result, verified by screenshot) while keeping "brand identity"
      (the primary color, a placeholder pending a real rebrand) and
      "rendering constants" (chrome physics, lighting) as separate,
      undocumented-together categories — conflating them would be a
      real mistake, not a simplification. See
      docs/workflows/design-system/plan.md.

### M. Continuity animation system (gated on I, J, L landing)
- [ ] Checked directly: transition-/animate- usage exists in exactly 14
      files today, all of it app-perf's press-state work or skeleton
      pulses. Zero enter/appear animation anywhere — new content (a
      DiscoveryFlow field resolving, a health verdict card, a freshly
      scanned DTC list) still renders with a hard cut. Matches
      Alejandro's own complaint exactly. Plan: map every appear/change/
      disappear moment in the app (connect flow field-by-field
      resolution, tab switches, mutation results, list population,
      modals) with current behavior, no-layout-shift compliance, and a
      recommended treatment per entry; then one shared motion vocabulary
      (a small set of named transitions reused everywhere, not
      per-component inline decisions), respecting motion-reduce
      throughout like the existing press-state pattern already does.
      Framer-motion vs. plain CSS transition-delay for sequenced/
      staggered reveals is a real open tradeoff, not decided yet. See
      docs/workflows/animation-system/plan.md.

### N. Clear-codes correctness and negative responses (src-tauri/src/elm)
- [ ] **Clearing codes has never worked on any car.** Root cause found
      2026-08-25 and reproduced by executable test against main, not
      inferred. Three defects:
      (1) `parser.rs` `payload_bytes` discards any single-byte first line
      as an ISO-TP length prefix. The UDS clear positive response IS a
      single byte (`54`), so `payload_bytes(["54"])` returns `[]` and
      `uds.rs`'s `payload.first() == Some(&0x54)` is **always false**. The
      UDS clear path is structurally incapable of reporting success, and
      the user is shown "the module refused" on a clear that very likely
      worked.
      (2) The `7F 14 78` responsePending sequence also returns false,
      because the check reads `first()` instead of looking past pending
      frames.
      (3) `obd.rs` `clear_and_verify` discards mode 04's response entirely,
      so `7F 04 22` conditionsNotCorrect, `NO DATA` and `BUS ERROR` are
      indistinguishable from success — and the UI then blames the car
      ("codes came straight back, those are active faults").
      Contributing: no NRC decoding anywhere; adapter error strings not
      recognised as errors (`clean_response` filters only `SEARCHING...`);
      no precondition checks (many ECUs refuse a clear with the engine
      running, which is the app's normal state); no settle delay before
      verification; no TesterPresent across the clear, with a 6s before-read
      against a 5s session timer; `1003`'s response ignored; `ATSP6` never
      undone by teardown, which pins the adapter to CAN for the rest of the
      connection and breaks the documented K-line Peugeot.
      Fix list and rationale: `docs/product/vehicle-interaction-architecture.md`
      section 7. Ships with a unit test per response shape.

### O. Operations ledger (src-tauri/src/db.rs, elm/, supabase/)
- [ ] Generalize `writes_log` into `operations`: every interaction with a
      vehicle, read or write, with the **raw request and response bytes**.
      That omission is why N's bug survived for months — the audit trail
      recorded the verdict `refused` without ever recording what the module
      actually said. One table serves the audit trail, the debugging record,
      the learning corpus, and report evidence. `writes_log` becomes a view
      so the existing Write history UI keeps working. Needs a retention
      policy from day one (full capture for writes and failures, bounded
      window for high-frequency successful reads). Depends on N.

### P. Capability model and pack schema (packages/uds-map, src-tauri/src/elm)
- [ ] Every operation the app can perform on a vehicle becomes one
      declarative entry: applicability, request, preconditions,
      authorization, expected response, known NRCs, risk, reversal,
      confidence, provenance. Migrate `uds-map.json`'s 21 brands / 180
      modules / 181 known DIDs into it without loss. One executor in Rust
      runs any capability. Coverage becomes a query over applicability,
      which is what `diagnostic-intelligence.md` needs and cannot currently
      answer. Service functions then stop being a new subsystem and become
      data — this is what makes the iCarsoft tier a population exercise
      rather than a rewrite, and it makes the existing write safety rail
      automatic since `risk`/`reversal` are what ConfirmWrite already
      demands. Rust and TS must derive from one schema instead of being
      hand-synced; that drift is already live (Rust silently drops
      `confidence` on brands/modules/DIDs, and `extract` rejects `len > 4`
      while `decodeKnownDid` does not).

### Q. Pack distribution (src-tauri, supabase/)
- [ ] Today `uds-map.json` is compiled in via `include_str!`, so a corrected
      module address needs a full rebuild and release. **Every learning the
      product accumulates is trapped behind a release cycle**, which makes
      the learning loop worthless until this changes. Runtime pack load with
      the bundled pack as offline fallback, signature verification, a
      binary-enforced service/privilege ceiling, separate signing roots for
      read knowledge and authorized operations, atomic activation,
      anti-rollback, key rotation/revocation, version pinned per scan so a
      report says which knowledge produced it, and signed emergency rollback
      without an app release. Depends on P.

### R. Reports (src/features, src-tauri)
- [ ] Today's reports are a single prompt to markdown in localStorage:
      not persisted, not versioned, not evidence-linked, owner-register
      only, no export. Alpha needs persisted versioned reports, evidence
      links into `operations` and fault observations, technical and
      customer registers, export, EN/ES. Depends on O.

### S. Learning loop (src-tauri, supabase/)
- [ ] Plane 3 of the architecture. Candidate labels from correlating unknown
      DIDs against known values, cross-vehicle agreement raising confidence,
      contribution **opt-in and VIN-free** (a VIN identifies a vehicle and
      its owner; raw ECU identity blocks are also excluded because they may
      contain VINs or stable serial numbers), strict allowlisted fields,
      review before promotion into a pack. An
      AI-proposed label stays a candidate. Depends on O and Q.

### T. Authorization / security access (post-alpha)
- [ ] `0x27` seed/key. **Algorithms are compiled-in code referenced by id;
      packs select an algorithm, never define one** — a pack carrying an
      executable transform would introduce arbitrary code if the channel
      were ever compromised. The binary must additionally bind every
      algorithm to allowed brands, address families, levels, services, and
      operation tiers. Designed for in P (the authorization
      field), populated here. Gated on research cataloguing which algorithms
      and routine identifiers are genuinely public per brand, with a real
      source per entry; an entry whose origin cannot be named does not ship.
      **Immobilizer and key programming are explicitly excluded** and must
      not be arrived at by drift: it is the one category with a direct
      theft-enablement path, and needs legal review plus customer
      verification as its own decision.

### U. Service functions (post-alpha)
- [ ] The iCarsoft-parity tier: oil/service reset, brake service mode,
      particulate-filter regeneration, throttle and idle relearn, battery
      registration, adaptation resets. Each is a `routine` capability behind
      the existing safety rail with a verified reversal path. Gated on T and
      on the routine-identifier hunt already scoped in write-caps
      increment 2. Note BSI is unreachable from the OBD port on the
      reference car, so PSA body/comfort functions are a hardware wall
      regardless of authorization.

## Done log

- 2026-08-20: theme locked to light everywhere (page + native + Tauri
  window); connect→discovery flash fixed; brand-emblem 3D scene from VIN
  WMI (Citroën chevrons + nameplate fallback); AI diagnosis card in
  Diagnose (user's own Anthropic key, localStorage-only); demo DTC story in
  mock (stateful scan/clear, P0420+P0301, freeze frame); dead body-color
  plumbing removed (agent-executed, tsc+cargo clean).
