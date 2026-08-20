# Redesign kickoff — where to actually start

_Companion to `01-audit.md`. This is a lean starting scaffold, not a finished spec — the redesign spec itself is yours to write (in this same folder, e.g. `03-spec.md`) once the open decisions below are settled._

## Why this structure and not more

The app is ~3,300 lines across 18 frontend files. That doesn't need a heavy design-system process, a component-library package, or a multi-phase rollout plan. Two docs (this one + the audit) plus a `ui.tsx` primitives pass is the right amount of process for a codebase this size — more structure than that would be solving a problem the app doesn't have.

## Open decisions (yours to make — these change the work, so nothing below assumes an answer)

1. **Theme**: keep OS-driven auto light/dark (fix nothing, just design a real light theme in `index.css`'s existing `:root` block), or add a manual toggle (persisted, e.g. `localStorage`) so the app doesn't silently flip based on your OS? You said "I want a light background" — worth being explicit about whether that means *light-only*, *light-default with dark still available*, or *light with a manual switch*.
2. **3D car — how far right now**: three real options, not mutually exclusive over time:
   - (a) **Polish the current placeholder** — it's an intentional abstract sketch, not broken; a lighter/cleaner version of the same idea could look good and ships in a day.
   - (b) **Real per-VIN model via CarImages API** — this is what the product plan already scopes, but it's gated on an unverified open item: "does CarImages actually cover the Citroën C4 III" (product-plan.md, Open items). Needs an API key + that check before it's buildable.
   - (c) **A small hand-picked archetype library** (sedan/hatchback/SUV/etc. — also an open item in product-plan.md) as a middle ground — closer to your real car's silhouette than the current wireframe, no external API dependency.
   Pick a starting point; (b) can still be the eventual target without blocking the rest of the redesign on it.
3. **Git baseline**: the previous sidebar-redesign work is uncommitted on `main` right now (see audit §8). Commit that as a checkpoint before branching for the visual redesign, so there's a clean "before" to diff against? (I haven't touched git — this is your call.)

## Recommended order of attack (once the decisions above are made)

1. **Housekeeping pass first** (small, mechanical, ~30 min): delete the dead `Tabs` component and leftover scaffold assets, drop the unused `class-variance-authority`/`@tauri-apps/plugin-opener` deps (or decide to keep+use them), fix the `ModuleFaults`/`mock.ts` `uds_clear` shape bug, swap the favicon. None of this depends on the design decisions above, so it's free to do immediately and gets noise out of the way.
2. **Primitives before views**: add `Input`, `Select`, `Table`, `Alert` to `ui.tsx` (see audit §3 for exactly what they need to replace) before touching any individual view's visuals. Otherwise the same restyle happens 3-6 times by hand across files that currently reinvent the same pattern.
3. **Tokens + `brand.md` together**: decide the new light palette, update `index.css`'s `:root`/`.dark` and `brand.md` in the same pass so they can't drift apart again. This is most of what "redesign the app" mechanically means here, since the view layer is already token-driven.
4. **`VehicleScene.tsx` rebuild**: separate track, per decision #2 above — it doesn't block the rest of the app's re-theming since it's already visually isolated (its own component, lazy-loaded).
5. **View-by-view pass**: with primitives + tokens in place, each view is mostly "does this still look right," not "rebuild this." `Diagnose.tsx`'s and `ModuleFaults.tsx`'s fault-found states are worth manually triggering (or backing with richer mock fixtures) since mock mode currently never shows them.

## What this plan deliberately does not include

No component-library package, no Storybook, no design-token build pipeline, no multi-week phased rollout. If the redesign later turns out to need any of those, add them then — starting with them now would be solving problems this app doesn't have yet.
