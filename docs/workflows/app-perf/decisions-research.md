# Decision log: researcher, app-perf

Each block: what, options considered, why, risk.

## Verifying the "unmount on tab switch" claim by reading code, not assuming

What: read `src/App.tsx` and `src/components/Shell.tsx` directly instead
of trusting the task brief's claim that the Shell mounts/unmounts views on
navigation.
Options: (a) take the brief's claim as given and move straight to
proposing a cache, (b) verify against the actual render code first.
Why: (b), per the role file's obligation to read the code that borders the
topic before anything else. The brief was right (`{view === "x" && <X />}`
is plain conditional rendering, no keep-alive), but confirming it directly
also surfaced the exact mechanism (React unmounts on the boolean flipping
false), which matters for how a query cache would actually fix it.
Risk: none, the claim held up.

## Running a real production build instead of estimating bundle size

What: ran `npx vite build` once to get real chunk sizes and the module
list, rather than estimating from `package.json` dependency weights or
Bundlephobia numbers for the libraries in isolation.
Options: (a) estimate from known per-package sizes, (b) build and read
Vite's own output.
Why: (b). The task explicitly said "do not just list file sizes, trace
what loads," and a real build is the only way to see what Rollup actually
kept versus tree-shook, which is how the VehicleScene dead-code finding
(section 3) surfaced. An estimate from package sizes would have missed it
entirely, since the wasted bytes are inside a file the project owns, not
in the three.js package itself.
Risk: the build was run against the current `main` checkout with no
uncommitted changes at read time; if the concurrent builder branch in the
other worktree lands different code before this research is read, the
exact KB numbers could drift. The proportions (recharts eager, VehicleScene
dead code, models never fetched) are structural and would not change from
small edits elsewhere.

## Tracing the active VehicleScene render path instead of listing every export

What: read `VehicleScene.tsx` end to end to find which function is
actually called from the exported `VehicleScene` component
(`BrandEmblemModel` -> `CitroenEmblem`/`NameplateEmblem`), rather than
assuming the presence of `GLB_URL`/`STL_URL`/`MODEL_URL` constants meant
those assets load.
Options: (a) list every asset path found via grep and assume all are
fetched, (b) trace the actual call graph to confirm which ones execute.
Why: (b), directly instructed in the task ("do not just list file sizes,
trace what loads"), and it changed the finding materially: the ~40 MB in
`public/models*` is not a runtime network cost today, it is dead weight in
the installer only, a different problem with a different owner (stream C,
already on the backlog for this exact file).
Risk: low. The comments in `VehicleScene.tsx` itself corroborate the
trace ("GlbCarModel above stays dormant", "swap back here if per-car
models return"), so this is not solely inferred from the render tree, the
code's own commentary agrees.

## Treating the recharts/mock.ts bundle findings as in-scope facts, not out-of-scope code review

What: included two findings (recharts eager in the main chunk, `mock.ts`
bundled unconditionally) that are arguably general code-quality
observations rather than pure "loading state" research.
Options: (a) leave them out as outside the stream H topic, (b) include
them under section 3 since they were surfaced directly by the bundle
investigation the task asked for.
Why: (b). The task explicitly asked to "read vite config and package.json
... note heavy assets ... trace what loads," and both findings came
straight out of that trace. Leaving out a real, load-bearing fact found
while doing the assigned investigation would violate "never present a
guess as fact" in spirit, by omission. Flagged plainly as facts for the
planner to size, not folded into the recommendation itself.
Risk: none, they are clearly separated from the two approaches and the
recommendation in section 8, so the planner can drop them without
unraveling the rest of the doc.

## Recommending build order (app-perf before i18n) instead of staying neutral

What: gave an explicit recommendation for stream sequencing (app-perf
first) instead of only listing that both streams touch the same files and
leaving the order to the planner.
Options: (a) neutral, just flag the conflict, (b) recommend an order with
reasoning.
Why: (b). The task explicitly asked for "an explicit section on sequencing
... recommend which builds first and why," and `docs/BACKLOG.md` already
frames this as a real open question stream H's research is meant to help
answer. The reasoning (data-layer rewrite vs JSX/copy rewrite touch
different axes of the same files) is a structural fact about what each
stream changes, not a preference call, so a recommendation is defensible
even though the planner has final say per the role file.
Risk: if the planner or user has product reasons to ship Spanish support
first regardless of rework cost (e.g. a tester deadline), this
recommendation could be overridden for reasons outside this research's
scope. That is expected and fine, the role file says the planner decides.

## Trusting third-party bundle-size and Tauri-integration sources at face value

What: cited Bundlephobia, a 2025 Refine comparison, a 2026 PkgPulse guide,
and a DeepWiki page on a community Tauri+TanStack Query template, rather
than installing the packages in this repo to measure directly.
Options: (a) install TanStack Query and SWR in a scratch project to
measure real gzip size and confirm the `invoke`-as-`queryFn` pattern
works, (b) rely on published sources and flag the size disagreement
openly.
Why: (b). Installing packages would touch `package.json`/lockfiles, which
crosses into code changes this researcher role must not make in the main
checkout. The `invoke`-as-Promise claim is also low-risk: TanStack
Query's documented contract is "queryFn returns a Promise," and Tauri's
`invoke` is typed as returning a `Promise<T>` in this repo's own
`src/lib/tauri.ts`, so the claim is corroborated by first-party code even
without a live install.
Risk: the two size sources disagree (13 KB vs 16 KB gzip); reported as a
range rather than a single confident number, and the range is small
enough that it does not change the recommendation either way.
