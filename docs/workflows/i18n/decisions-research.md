# Decision log — research (i18n stream)

## Rough string counts instead of exhaustive enumeration
- **What:** used grep-based text-node counts per file instead of manually
  reading every JSX return and listing every string.
- **Options:** (a) full manual inventory now, (b) grep-based shape plus a
  named follow-up extraction pass.
- **Why:** the role file and the task explicitly ask for the SHAPE of the
  string landscape, not a full inventory; extraction tooling (whichever
  library or the typed-dictionary route) does the exhaustive job better
  than manual reading would, at build time when the actual keys get named.
- **Risk:** the grep counts undercount (miss template literals, ternaries,
  attribute strings). Flagged explicitly in research.md so the planner
  doesn't mistake it for a real total.

## Library comparison not web-verified
- **What:** the react-i18next / lingui / react-intl / paraglide-js
  comparison table is built from general knowledge, not a web search this
  session.
- **Options:** (a) trust general knowledge and flag it, (b) spend the
  research budget on WebSearch/WebFetch to confirm current versions,
  bundle sizes, and Tauri-specific integration reports.
- **Why:** these are all long-established, stable projects (i18next and
  react-intl in particular have been the standard for years); the
  qualitative trade-offs (pluralization model, extraction tooling,
  TS-safety) that matter for this decision are architectural properties of
  each library, not version-specific facts likely to have changed. Time
  was better spent reading this repo's actual constraints (backend
  strings, existing conventions) than re-confirming public library facts.
- **Risk:** if paraglide-js's React/Vite support or Tauri-specific reports
  have shifted meaningfully, that would only affect option ranking, not the
  core two-way recommendation (typed dictionary vs. a framework). Flagged
  as a scope cut in research.md; the planner or builder should do a quick
  doc-check on the chosen library right before implementation regardless.

## DTC library and AI prompts treated as "content," not "UI copy"
- **What:** research.md calls out `dtc.ts` and the AI system prompts as
  needing their own solution, separate from whichever string-key system
  wins.
- **Options:** (a) treat all translatable text as one uniform problem the
  chosen i18n approach solves, (b) split "short UI copy" from "long
  structured/generated content" as different problems.
- **Why:** `dtc.ts` entries are paragraph-length prose keyed by DTC code,
  not short reusable UI strings — cramming them into a typical i18n
  key-value system would work mechanically but hide the real cost (30+
  entries x 2 languages x multiple prose fields) behind a misleadingly
  simple-looking `t("dtc.p0420.meaning")` call. The AI prompts are not
  translated content at all — they are instructions to a model, and the
  right fix is a locale-conditioned instruction, not a translated prompt
  string. Conflating the three would give the planner a false sense that
  picking a library "solves i18n" fully.
- **Risk:** none identified — this is a scoping clarification, not a
  technical bet.

## Number/date localization presented as an open question, not decided
- **What:** research.md documents that the app already formats numbers and
  dates in a technical, non-locale-aware way (`.toFixed()`, raw ISO
  slicing) and treats "keep it monospace-technical" vs. "localize decimal
  commas for Spain" as a genuine open trade-off for the planner.
- **Options:** (a) recommend locale-aware number formatting outright
  (Spain uses comma decimals), (b) recommend keeping the existing
  technical convention, (c) present both without picking, backed by what
  the code already does.
- **Why:** the existing codebase already made a deliberate choice here (47
  `.toFixed()` calls, near-zero `Intl` usage) that lines up with engineering
  pattern #6's "no decorative formatting." But Spanish testers seeing
  period-decimals on values like fuel consumption is a real UX question
  the user or planner should weigh in on, not something a researcher should
  silently resolve by recommending one way.
- **Risk:** low — worst case the planner has to make an explicit call
  research.md flagged as undecided, which is the intended outcome.

## Skipped VehicleScene.tsx / three.js layer
- **What:** did not open `src/components/VehicleScene.tsx`.
- **Options:** (a) read it for completeness, (b) skip on the assumption
  it's visual (3D emblem geometry) with little to no user-facing text.
- **Why:** the task's skim list did not include it, and BACKLOG's stream C
  describes it as geometry/rendering work, not copy. Time was better spent
  on the backend string surface, which the task explicitly asked to check
  and which turned out to have real findings (duplicated PID labels,
  un-translatable notifications, raw error strings).
- **Risk:** small chance of a missed string or two (e.g. a loading label
  inside the 3D view). Low impact — logged in research.md's scope check so
  the extraction pass at build time will still catch it.
