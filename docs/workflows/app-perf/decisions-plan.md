# Decision log: planner, app-perf

Each block: what, options considered, why, risk.

## Accept research option A (TanStack Query v5), no counter-proposal

What: adopted the research's recommendation A wholesale instead of the
hand-rolled cache (option B) or a hybrid.
Options: (a) TanStack Query v5, (b) hand-rolled `Map` cache plus a
`useCachedInvoke` hook, (c) query library for reads only, keep hand-rolled
mutations.
Why: (a). Research section 1 shows seven views repeating the same
invoke+useState+useEffect shape, and the existing mutate-then-refetch code
in Diagnose/Vehicle is literally the useMutation+invalidateQueries pattern.
13-16 KB gzip is noise next to the 204 KB main chunk. Option B re-solves a
solved problem; option C would leave two data-layer idioms in the codebase,
which is worse for the i18n stream that touches these files next.
Risk: a new dependency to keep current. Accepted; it is the most widely
used library in this category.

## Plain useQuery status flags for cards, not per-card Suspense

What: the standard card pattern uses `isPending`/`isError`/empty checks,
not `useSuspenseQuery` with per-card Suspense boundaries.
Options: (a) status flags, (b) useSuspenseQuery + Suspense + ErrorBoundary
per card, (c) mix.
Why: (a). The acceptance criteria require "no data yet" to be visually
distinct from "loading", which needs the component to inspect fetched data
anyway; Suspense only models the pending half. Per-card error boundaries
are new machinery a Sonnet builder could wire subtly wrong, and the app has
none today. The two existing lazy-chunk Suspense boundaries stay untouched.
Risk: slightly more per-card boilerplate. Contained by putting the pattern
in one shared shape (CardSkeleton + standard branches) defined once.

## Defer the VehicleScene dead-loader bundle fix to stream C

What: evaluated pulling the dead OBJ/GLB/STL loader code out of the 264 KB
VehicleScene chunk inside this stream, decided against. This stream does
not touch `VehicleScene.tsx`.
Options: (a) delete or split the dormant exports here (real ~saving inside
the lazy chunk), (b) leave for stream C which owns the file.
Why: (b). Three reasons. One, the pipeline rule is one stream = one file
boundary, and stream C is already chartered for exactly this file; touching
it here creates the overlap the README forbids. Two, the fix is not a
config flag: it means deleting or re-exporting code in the file with the
worst failure history in the repo (the 3D saga), for bytes that sit in a
lazy chunk off the startup path, so the payoff does not justify the blast
radius. Three, the research itself files it under stream C. The two bundle
fixes this stream DOES take (mock.ts gating, recharts lazy boundary) touch
only files inside this stream's boundary.
Risk: the 264 KB chunk stays fat until stream C runs. Acceptable; it loads
lazily and is cached after first load.

## Take the recharts split as an in-scope step, with an explicit fallback

What: included moving both recharts usages behind one lazy
`charts.tsx` boundary, even though the research only flagged the fact.
Options: (a) skip, mock.ts gating only, (b) include with a fallback, (c)
include unconditionally.
Why: (b). Recharts sits in the eager main chunk purely because Overview is
the default view; the skeleton pattern this stream builds is exactly what
makes a lazy chart acceptable (sized fallback, no jump). But chunk-split
behavior is the one place Vite/Rollup can surprise, so the plan states the
fallback: ship the mock.ts fix alone and log it.
Risk: a brief chart pop-in on first Overview load. Mitigated by the sized
skeleton; if it still reads as a flash in review, the fallback applies.

## Invalidate everything on connect, nothing on live-update

What: the event-to-cache rule is: `conn-status` -> connected invalidates
all queries; `live-update` never invalidates; DiscoveryFlow completion
invalidates `report_cars` + `car_report` and replaces `refreshKey`.
Options: (a) fine-grained per-event invalidation lists, (b) coarse
invalidate-all on connect, (c) also invalidate on live-update ticks.
Why: (b). A new session can add data behind any view, and with local IPC a
blanket revalidate is cheap; a curated list would rot as commands are
added. (c) is rejected because live-update fires continuously and would
thrash the cache; live gauges already have their own prop path, which the
research says to leave alone.
Risk: a burst of refetches at connect time. Harmless locally; staleTime
keeps it from repeating.

## staleTime 15s, refetchOnWindowFocus off

What: pinned client defaults instead of leaving them to the builder.
Options: staleTime 0 (always revalidate on remount), Infinity (never), a
short window.
Why: 15s gives instant cache renders on tab flips while still background
revalidating after real gaps, which is also what the acceptance test
observes. Infinity would make event invalidation the only refresh path and
mask wiring mistakes. Window-focus refetch is off because this is a
desktop webview where focus events are noisy and data changes only via
this app's own actions and events.
Risk: up to 15s of staleness if something outside the event system writes
data. Nothing does today.

## Migration order: Overview first despite being the showcase view

What: step 1 bundles the provider, the query hooks file, App.tsx event
wiring, refreshKey removal, and the Overview migration.
Options: (a) start with a low-risk view (Vehicle or Lab) to warm up, (b)
start with Overview plus the App wiring.
Why: (b), per the role rule that the step most likely to fail goes first.
The risk in this stream is not any single view's hooks, it is the
App-level wiring (provider placement, discovery-completion invalidation
replacing refreshKey, connect-time invalidation). Overview is the only
view that exercises all of it, and it is the default view, so failure is
loud and immediate. A stated fallback (keep refreshKey one extra commit)
caps the risk.
Risk: the first PR commit is the largest. Accepted; later steps shrink.

## Scope cuts

What: excluded conn/live prop-drilling refactor, DevTools dependency,
public/models cleanup, Rust changes, any i18n prep, any copy rewrites.
Options: fold some in while files are open, or cut.
Why: cut. Research section 7 says conn/live works as is; DevTools is dead
weight in a shipped desktop bundle; models and VehicleScene belong to
stream C; i18n is sequenced after this stream precisely so it touches
final code. Builders inherit the planner's discipline or their sprawl.
Risk: none material; each cut has a home elsewhere.
