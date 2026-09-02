# shadcn/ui is where new components come from

_Written 2026-09-02, when the toast system moved to sonner. Companion to `01-audit.md` and `02-kickoff-plan.md`._

## The rule

**New components come from shadcn/ui, into `apps/desktop/src/components/ui/`.**
Add them with the CLI, from `apps/desktop`:

```bash
npx shadcn@latest add <name>     # lands in src/components/ui/<name>.tsx
```

**The hand-made kit in `apps/desktop/src/components/ui.tsx` is frozen.** It keeps
working, keeps its call sites, and gets bug fixes — it does not get new
components. A file (`ui.tsx`) and a directory (`ui/`) with the same name sit
side by side on purpose: the import path says which kit a component came from,
so there is never a question about which one is being extended.

```
components/ui.tsx        the frozen kit  →  import { Card } from "@/components/ui"
components/ui/sonner.tsx shadcn/ui       →  import { Toaster } from "@/components/ui/sonner"
```

Nothing is being ported wholesale. A frozen kit component is replaced when
something else forces the question — the way `Toast` was, when the toast
needed a queue it did not have. Until then, replacing a working primitive is
churn with a diff attached.

## What is set up

| | |
|---|---|
| shadcn CLI | 4.19.1 |
| Tailwind | 4.3.3 (v4 — no `tailwind.config`, the theme lives in CSS) |
| style | `base-nova`, base primitives `@base-ui/react` (the CLI's current default) |
| icons | lucide, which the app already used |
| `components.json` | `apps/desktop/components.json`; CSS entry `src/index.css`, aliases `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks` |

`src/index.css` imports two things the registry's components are written
against: `shadcn/tailwind.css` (data-state variants, `scroll-fade`, `shimmer`)
and `tw-animate-css` (enter/exit keyframes). Both only declare variants and
utilities — they restyle nothing, which is why they can sit over this app's
token layer without touching an existing component.

Three things the CLI's `init` did were reverted deliberately:

- **the Geist font.** The app is Inter. `@theme` keeps `--font-sans: var(--font-body)`.
- **`@layer base { * { @apply border-border … } }`.** That gives every element in
  the app a default border colour and outline. The app sets its own.
- **a neutral oklch palette in `:root`.** It overwrote `--accent` — the app's
  blurple — with light grey. The palette is Sonda's; see below.

## The token mapping

shadcn components are written against a fixed set of role names. They are not
a second palette: every role resolves to a Sonda token in
`src/theme/tokens.css`, so a component installed from the registry comes out in
the brand's colours with nothing to restyle. `index.css` names them for the
utility layer (`bg-popover`, `text-muted-foreground`, `border-input`).

| shadcn role | light (`:root`) | dark (`.dark`) |
|---|---|---|
| `background` | `--bg` | `--section` |
| `foreground` | `--text` | `--section-text` |
| `card` / `card-foreground` | `--surface` / `--text` | `--section` / `--section-headline` |
| `popover` / `popover-foreground` | `--surface` / `--text` | `--section` / `--section-text` |
| `primary` / `primary-foreground` | `--accent` / `--surface` | `--section-accent` / `--section` |
| `secondary` / `secondary-foreground` | `--neutral-900` / `--neutral-200` | `--section-chip-bg` / `--section-chip-text` |
| `muted` / `muted-foreground` | `--neutral-900` / `--neutral-500` | `--section-chip-bg` / `--section-muted` |
| `accent` | **not mapped — see below** | — |
| `accent-foreground` | `--surface` | `--section` |
| `destructive` / `destructive-foreground` | `--stop` / `--surface` | `--stop-line` / `--section` |
| `border` | `--divider` | `--section-divider` |
| `input` | `--divider` | `--section-divider` |
| `ring` | `--accent` | `--section-accent` |
| `radius` | `--radius-md` (8px) | — |
| `chart-1…5` | `--accent-400`, `--accent-600`, `--accent-2-400`, `--accent-2-600`, `--neutral-600` | the on-dark accents |
| `sidebar*` | `--surface` / `--text` / `--accent` / `--accent-900` / `--divider` | the `--section-*` family |

### The one collision: `accent`

shadcn's `accent` role means *a subtle hover surface* — `hover:bg-accent
hover:text-accent-foreground` on a menu item. This app's `accent` is the solid
blurple, and about ninety call sites (`bg-accent`, `ring-accent`,
`text-accent`) depend on that. The app's meaning wins, and `--accent` is
deliberately absent from the bridge in `tokens.css`.

**So: a shadcn component that reaches for `hover:bg-accent` gets edited, in its
own source under `components/ui/`, to use `bg-accent-900`** (the palest tint —
which is what the role actually wants). We own that source; that is the point
of shadcn. `accent-foreground` *is* mapped, to `--surface`, so `bg-accent
text-accent-foreground` is white on blurple and correct as-is.

### Dark mode

The app is single-theme light and never sets `.dark` (see `main.tsx`'s comment
on why). The dark values exist so a shadcn component dropped on the one dark
ground the brand has — the `--section-*` family, used by the login panel and
the landing page — is right by construction rather than by accident.

## Toasts

The first and so far only shadcn component is `sonner`. See
`components/ui/sonner.tsx` (the rail) and `components/toast.tsx` (the app's
`toast.success/info/warning/error` wrapper over it). The app's policy on top of
sonner — per-variant dwell times, what `sticky` means, which variants
interrupt a screen reader — is in `lib/toast.ts`, tested in `lib/toast.test.ts`.
