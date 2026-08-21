# Data core: the real schema (v2)

Drafted 2026-08-21, the same night a second real vehicle (a ~1999-2000
Peugeot, VIN unreadable) exposed what the old schema couldn't do. The
product plan (vault `product-plan.md`, 2026-08-18) already designed this
shape as workstream #1 and it never got built — this stream builds it.

Owner's explicit call, same night: **local data is disposable test data.**
No migration of existing rows — detect the old schema, drop it, create v2.
That decision is what makes this buildable in one pass instead of a
risky staged migration.

## Principles

1. **A vehicle is an entity with its own id — VIN is an attribute, not the
   key.** Proven necessary by a real car whose ECU never answers Mode 09
   (0 bytes, 3 retries, responsive bus, multiple reconnects). `vehicles.vin`
   is nullable+unique; `vehicles.display_name` is the human fallback
   identity ("name this car" UX when VIN is unreadable).
2. **Every recorded fact hangs off `vehicle_id` and `connection_id`.**
   No more `COALESCE(vin, ?1)` tricks, no more global scan history. A fact
   recorded while the vehicle is unidentified carries NULL `vehicle_id`
   honestly — and can be claimed later when the user names the car.
3. **Postgres-shaped, running on SQLite.** Supabase (Postgres + Auth + RLS)
   is the stated future backend. Local tables mirror the target column
   shapes; `org_id`/`owner_user_id` exist now (TEXT/uuid, always NULL
   locally) so multi-tenant doesn't need a second schema rethink.
   `users`/`organizations` themselves are NOT local tables — they belong to
   the Supabase phase (auth.users + org tables + RLS policies, sketched at
   the bottom of this doc).
4. **Clean slate over clever migration.** `PRAGMA user_version` gates the
   schema. Version 0 (the old shape) is dropped wholesale on first open.
   Version 2 is created fresh. uds_modules' 4 PSA defaults re-seed.

## Schema v2 (SQLite now; column shapes match target Postgres)

```
vehicles                 -- THE entity. vin nullable (pre-Mode-09 ECUs are real).
  id                     INTEGER PK
  vin                    TEXT UNIQUE NULL
  display_name           TEXT NULL          -- user-assigned; the identity when vin is NULL
  make, model, trim      TEXT NULL          -- decoded (WMI/etc.) or user-entered later
  year                   INTEGER NULL
  fuel_price             REAL NOT NULL DEFAULT 1.50   -- per-vehicle (was a global car_info row)
  created_at             TEXT NOT NULL
  first_connected_at     TEXT NULL
  org_id                 TEXT NULL          -- reserved: Supabase org uuid, never set locally
  owner_user_id          TEXT NULL          -- reserved: Supabase auth.users uuid, never set locally

connections              -- one physical link session (was `sessions`)
  id                     INTEGER PK
  vehicle_id             INTEGER NULL FK vehicles   -- NULL until identified
  device_kind            TEXT NULL          -- 'vgate_icar_pro' | 'obdlink_mx_plus' | ...
  elm_version            TEXT NULL
  protocol               TEXT NULL
  started_at, ended_at   TEXT

readings                 -- unchanged purpose; gains both FKs
  id                     INTEGER PK
  connection_id          INTEGER NOT NULL FK connections
  vehicle_id             INTEGER NULL FK vehicles    -- denormalized copy for per-car queries
  ts, key, value         as before
  INDEX (vehicle_id, key, ts) · INDEX (connection_id)

dtc_scan_events          -- one scan invocation (was `dtc_scans`), now vehicle-scoped
  id, connection_id FK NULL, vehicle_id FK NULL, ts,
  mil_on, dtc_count, voltage, freeze_json

dtc_codes                -- one row PER CODE per scan event (plan.md's per-code table,
  id, scan_event_id FK,  -- named dtc_codes not dtc_scans to avoid colliding with the
  vehicle_id FK NULL,    -- old table's name in everyone's head)
  code TEXT, status 'stored'|'pending'|'permanent'
  -- lifecycle (first seen → cleared) is a QUERY over events, not columns —
  -- deliberate simplification of product-plan.md's first_seen_at/cleared_at
  -- shape: no upsert bookkeeping to get wrong, derivable when needed.

writes_log               -- gains both FKs (audit rows were global before)
  ... as before + connection_id FK NULL, vehicle_id FK NULL

uds_modules              -- brand-level definitions: stays GLOBAL (correct as-is)
uds_probes               -- gains vehicle_id FK NULL (a probe is really per-car knowledge)

discovered_modules       -- product-plan.md's auto-discovery tables, created now so the
discovered_dids          -- shape is locked; no writer yet (discovery engine is a later stream)

app_settings             -- app-level key-value (bt_connect_level lives here;
                         -- car_info is GONE — its vin/protocol/fuel_price rows all had
                         -- per-vehicle homes that now exist for real)

parts                    -- owner-requested: parts catalog, cross-brand
  id, oem_ref TEXT NULL, name TEXT, category TEXT NULL, notes TEXT NULL
part_fitments            -- which make/model/year-range a part fits; multiple rows per part
  id, part_id FK, make, model NULL, year_from NULL, year_to NULL, engine_code NULL
  -- cross-brand sharing (Stellantis: same part fits a Peugeot and a Citroën) is just
  -- two fitment rows on one part — no special machinery needed.
vehicle_parts            -- a part actually on a specific vehicle (service-history seed)
  id, vehicle_id FK, part_id FK, installed_at NULL, notes NULL
  -- parts/part_fitments/vehicle_parts have NO UI yet — shape locked now per the
  -- owner's ask, first consumer is a later stream. Empty tables cost nothing.
```

## Identity flow (the part the old schema got wrong)

1. Connect → `connections` row created, `vehicle_id` NULL.
2. VIN read (3 retries, already built): success → `ensure_vehicle(vin)`
   get-or-creates the `vehicles` row, stamps `first_connected_at`, links the
   connection, and reports `vehicle_id` + `vehicle_is_new` on ConnStatus.
   `vehicle_is_new` replaces the frontend's whole knownVins-snapshot dance —
   the DB simply says whether this connect created the row.
3. VIN unreadable → connection stays unlinked; readings/scans record NULL
   `vehicle_id`; Overview shows the honest unknown-vehicle state with a
   **"Name this car"** action → `name_current_vehicle(name)` creates a
   VIN-less vehicle row, links the live connection, and back-stamps the
   rows already recorded on this connection. Reconnecting the same physical
   car later can't be auto-recognized (no VIN) — the UX must ask, not guess.
   v2 ships naming; "claim an old unnamed connection later" is a later UX.

## Command surface (renamed where the old name was a lie)

- `report_cars` → `list_vehicles` → rows of `{id, vin, display_name, connections}`
- `car_report(vin)` → `vehicle_report(vehicle_id)` (same CarReport payload + vehicle_id)
- `car_info` (global kv) → `vehicle_info(vehicle_id)` (the vehicles row) — the
  Vehicle tab shows a real entity now, plus `set_vehicle_name`.
- `set_fuel_price(price)` → `set_fuel_price(vehicle_id, price)`
- `dtc_history(limit)` → `dtc_history(vehicle_id | null, limit)` — null means
  "the current unidentified connection's scans," not "everything."
- `ai_context`/`export_json` gain the same optional vehicle scope.

## Supabase phase (documented target, NOT built now)

- `auth.users` (Supabase-managed) · `organizations(id, name)` ·
  `org_members(org_id, user_id, role 'owner'|'tech'|'viewer')`.
- `vehicles.org_id`/`owner_user_id` become real FKs; RLS: a row is visible
  iff `org_id` in caller's orgs OR `owner_user_id` = caller.
- Solo owners get a personal org OR plain owner_user_id ownership —
  decide at that phase, columns support both.
- Local SQLite keeps working offline; sync strategy (push-up vs live
  Postgres) is that phase's design question, deliberately not this one's.
