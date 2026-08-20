# Plan: centralized car reference data

Written directly, same as ../monorepo/plan.md. Gated on the Effect
migration landing first — this touches `src/lib/brand.ts` and the data
boundary Effect's DeviceService work is currently restructuring, same
overlap risk already named in the monorepo plan.

## What this is, and what it deliberately is not

This is *reference* data: VIN WMI → brand (today's `brand.ts`), and later
deeper VIN decode (model/trim/year patterns) — static, identical for
every install, not tied to any specific user's car. It is not the same
thing as the app's *operational* data (a specific connected car's
readings, DTC history, sessions — `sessions`/`readings`/`dtc_scans` in
SQLite today, staying there). Conflating the two was the risk in
Alejandro's original framing ("a DB or JSON file with all the data of
the cars... brand detection by VIN, models, all") — the right answer
differs by data type, not one blanket choice.

Reference data's requirements are different from operational data's:
offline-first (a diagnostic tool in a garage with no wifi still has to
identify the brand), identical across every install (no per-user state),
and versioned/shippable like any other bundled asset. That points at a
structured JSON dataset in a real `data/` folder, not a live database
table — a live table buys nothing here today and costs an offline
dependency.

## Scope for this pass

1. **Formalize the WMI table.** Move `brand.ts`'s inline `WMI` record into
   `data/wmi.json` (or split by region if it grows large enough to want
   that), with the confidence/source metadata the audit
   (`docs/workflows/3d-logos/wmi-audit.md`) already produced kept
   alongside each entry, not lost in the move — that audit is real,
   checked work and the data format should preserve it (a `confidence`
   and `source` field per entry, not just `key`/`name`).
2. **Fold in the audit's "worth considering" additions**, each on its own
   merit with the same confidence labeling, not bulk-added: SJK/SHS
   (Nissan/Honda UK siblings), LVY (Volvo China), 7G2/7SA (Tesla Austin),
   WA1 (Audi SUV line) were the strongest candidates the audit named.
3. **`brandFromVin` becomes a thin lookup over the JSON**, not a rewrite
   of the function itself — `src/lib/brand.ts` stays the code entry
   point, it just reads from `data/wmi.json` instead of an inline object
   literal.
4. **Room to grow into deeper VIN decode** (model/trim/year, not just
   brand) without redesigning the shape now — `data/wmi.json` stays
   brand-only for this pass; a `data/models/<brand>.json` per-brand file
   is the natural next file once that work is real, not something to
   speculatively scaffold empty today.

## What this does NOT do in this pass

- No Supabase, no live database for this data. The mobile/web
  multi-platform case for syncing this centrally (fix a wrong WMI entry
  without an app-store release) is real but not now — there's one app
  today. Revisit once `apps/mobile` (../monorepo/plan.md) is real and
  actually needs to consume the same dataset without a rebuild.
- No deeper VIN decode data (model/trim/year) yet — brand only, matching
  what's actually needed today. Scoping that now would be speculative
  ahead of a real requirement, the same trap research.md flagged for the
  Effect stream's Supabase-readiness question.
- No change to the emblem/GLB asset pipeline (`public/emblems/`) — that's
  a separate, already-mature system, this plan only touches the WMI
  lookup table.

## Sequencing

Gated on the Effect migration landing, for the same reason as the
monorepo plan: `brand.ts` and the data-loading boundary are exactly what
Effect's `DeviceService`/Schema work is currently restructuring
(`src/core/`, feature folders). Moving `brand.ts` to read from a JSON
file at the same time risks the same kind of conflict already resolved
once this session. Once Effect lands, this is a small, clean, one-file
starting point — `packages/data` in the monorepo plan is where it lives
once that scaffolding exists too, so these two plans converge at the
same destination from two different starting problems.
