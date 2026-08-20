# Plan: continuity animation system

Written directly, gated on ws/effect-architecture merging and ws/monorepo
landing first — same overlap-risk reasoning as every other plan written
this session. Both of those touch most of src/; adding a third
sweeping change (every appear/transition in the app) at the same time
guarantees conflicts, not saves time.

## The actual gap, checked directly, not assumed

Grepped the app first: `transition-`/`animate-` usage exists in exactly
14 files, all of it either app-perf's press-state work (`active:scale`
on buttons) or the skeleton-pulse loading state. Zero enter/appear
animation anywhere — a new section (a DiscoveryFlow row resolving, a
health verdict card, a freshly-scanned DTC list) renders with a hard cut,
not a transition. This matches Alejandro's own complaint exactly: "you
have the identifying part, then you get something new below it, it
appears suddenly." Not a vague ask, a specific, checkable, currently-true
gap.

## Scope: map every state transition, not just "add animations"

Alejandro's own framing: "map every part in the application... and
animate its appearance properly." Concretely, this plan's first
deliverable is the map itself — an inventory, not code — of every place
content appears/changes/disappears in the app today:

1. **Connect flow**: ConnectGate → DiscoveryFlow's step sequence
   (discovering → scanning → results), each field resolving one at a
   time (VIN, protocol, ELM version, sensor count, fault count) — this is
   the exact sequence Alejandro named.
2. **Tab switches**: Overview/Live/History/Diagnose/Lab/Vehicle — since
   app-perf's TanStack Query migration, these render instantly from
   cache (no loading flicker) but still have no transition between the
   old and new view's content.
3. **Mutation results**: scan-for-codes populating the Latest Scan card,
   clear-codes' before/after banner, AI report generation's text
   appearing.
4. **List/card population**: health verdict cards on Overview, scan
   history rows, write history rows, DID scan results in Lab, probe
   list — anywhere a list goes from empty/skeleton to populated.
5. **Modals**: DtcDetailModal, ConfirmWrite — currently instant, not
   evaluated for whether they need motion (a modal appearing instantly
   is often correct, unlike content silently appearing inline).
6. **The 3D emblem itself**: already animates (spin), out of scope here
   except for how its LIVE/status label and surrounding card content
   relate to the rest of the sequence.

Each entry in the map gets: current behavior (checked in the running
app, not guessed), whether it currently violates "no layout shifts"
(BACKLOG.md's own principle — motion must never cause layout shift,
which is a stronger constraint than most animation work, and the
existing modals were already built overlay-style specifically to avoid
this), and a recommended treatment (fade-in, slide-up-and-fade, stagger
for sequential fields, or explicitly "no animation, instant is correct
here").

## Design direction: one motion language, not per-component decisions

Alejandro's actual goal is "continuity feeling... throughout the whole
flow," which means this needs a shared vocabulary, not each component
picking its own duration/easing. Concretely:
- A small set of named transitions (e.g. `appear`, `appear-stagger`,
  `settle`) defined once, reused everywhere — likely as Tailwind
  utility combinations or a tiny motion primitives file, not a
  per-component inline transition string the way today's `active:scale`
  presses are hand-written in each button.
- Respect `motion-reduce` everywhere, matching the existing press-state
  pattern (`motion-reduce:transition-none`) already established in
  `ui.tsx` — this is not new ground, just extending an existing,
  correct convention consistently.
- Sequential/staggered reveals (the DiscoveryFlow field-by-field
  resolution) need actual sequencing, not just a CSS transition on each
  field independently — worth deciding whether this needs a small
  animation library (framer-motion, since there's already a
  `framer-motion-best-practices` skill available) or is achievable with
  plain CSS transition-delay per field. Real tradeoff to resolve in
  planning proper, not decided here.

## What this does NOT do in this pass

- Does not touch the 3D scene's own animation (spin speed, starfield
  drift) — those are already tuned and out of scope.
- Does not redesign any component's layout — this is motion on top of
  existing layouts, not a visual redesign (that's the separate Diagnose
  UX stream).
- Does not add a new dependency without a real evaluation — framer-motion
  is a candidate, not a decision, in the section above.

## Sequencing

Gated on ws/effect-architecture (touches most views) and the monorepo
migration (moves every file) landing first. Once both are in, this plan
graduates to a real research pass (confirm the current-behavior column
of the map by running the app, not from memory) before implementation
starts — the map above is accurate as of this planning pass but should
be re-verified against whatever state the app is in once its two
prerequisite streams land, since both touch the exact views this plan
maps.
