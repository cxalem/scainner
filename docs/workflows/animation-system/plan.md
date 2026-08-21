# Plan: continuity animation system

Written directly, gated on ws/effect-architecture merging and ws/monorepo
landing first — same overlap-risk reasoning as every other plan written
this session. Both of those touch most of src/; adding a third
sweeping change (every appear/transition in the app) at the same time
guarantees conflicts, not saves time. Both merged 2026-08-20, unblocking
this.

## Status (2026-08-21): first PR ships items 1 and 5 of the map below

Alejandro named two concrete instances of the gap directly: DiscoveryFlow's
sensor table appearing and shoving the "Go to dashboard" button down with
no transition, and modals opening with a hard cut. Those are map items 1
and 5 — this first PR ships exactly those two, not the full map. Items 2-4
(tab switches, mutation results, list population) are real and still
open, sequenced next.

**Library decision, resolved: framer-motion.** The tradeoff this plan
flagged as unresolved is decided — staggered field-by-field reveals and
animating a sibling's reposition when a new element mounts nearby both
need real JS sequencing or FLIP-style layout tracking that plain CSS
doesn't give you without a lot of hand-built plumbing. Real bundle cost
accepted, same tradeoff shape as the Effect migration's own accepted
cost. `reducedMotion="user"` on a root `MotionConfig` in main.tsx covers
every `motion.*` component's reduced-motion handling from one place.

New `apps/desktop/src/motion/index.ts` is the shared vocabulary the
Design direction section below asked for: `backdropVariants`/
`modalPanelVariants` (modals), `appearVariants` (a block of content
appearing in place), `staggerContainer`/`staggerItem` (sequential
reveals). Applied to `ConfirmWrite.tsx`, `DtcDetailModal.tsx`, and
`DiscoveryFlow.tsx`.

**One real bug found and fixed during this pass, worth recording because
it's a real framer-motion gotcha, not a one-off mistake:** the first cut
put a bare `layout` prop on DiscoveryFlow's outer content column, so its
own sibling (the Go-to-dashboard button) would slide into place instead
of jumping when the sensor table mounted above it. Alejandro caught the
actual effect live: "everything's moving up it's deformed... the two
sections above the discovery of the sensors get deformed too." `layout`
(not `layout="position"`) makes framer-motion track the element's full
box — position AND size — so when the column's height changed, it
scaled/stretched the box (and everything inside it not independently
tracked) to interpolate the size change, visibly warping content that
never should have moved at all. Fixed by removing `layout` from the
container entirely and using `layout="position"` (position only, never
scale) on only the specific elements that need to slide: the info card,
the sensor table, the button. Worth remembering for every future
`layout` usage in this app: default to `layout="position"`, reach for
bare `layout` only when a size change genuinely needs to animate too.

Verified live twice (visual/animation work is the documented exception
to "verify with a test" in engineering.md rule 1): first pass caught the
deform bug directly from Alejandro's own live testing; second pass after
the fix watched the same discovering → scanning → results sequence
end to end with no distortion at any captured frame, opened
`DtcDetailModal` mid-fade, no console errors. tsc clean, forced
`turbo run test` still green (no logic changed here — presentation
only, no new tests added for the same reason rule 11 gives UI rendering
tests low priority: nothing in this change is a pure function worth
covering, and this app has no component-test harness yet).

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
