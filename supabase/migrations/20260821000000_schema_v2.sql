-- Scainner schema v2 — the Postgres/Supabase half of
-- docs/workflows/data-core/plan.md. The local SQLite schema
-- (apps/desktop/src-tauri/src/db.rs) mirrors these column shapes on
-- purpose; this migration is the multi-tenant target it was shaped for.
--
-- Tenancy model: a vehicle belongs to an organization (repair shop, fleet)
-- OR directly to a user (solo owner) — both columns exist, RLS accepts
-- either. auth.users is Supabase-managed; only the org layer is ours.

-- ---------- tenancy ----------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'tech', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- ---------- vehicles: THE entity ----------

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  -- Nullable on purpose: pre-Mode-09 ECUs are real (a ~2000 Peugeot never
  -- answers the VIN request). display_name is the human identity then.
  -- UNIQUE per tenant, not globally: two different owners can each have a
  -- car with an unreadable VIN, and (eventually) a car can change hands.
  vin text,
  display_name text,
  make text,
  model text,
  year int,
  trim text,
  fuel_price numeric not null default 1.50,
  created_at timestamptz not null default now(),
  first_connected_at timestamptz,
  org_id uuid references organizations(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete cascade,
  -- A vehicle must belong to someone — this is what "each car lives under
  -- its tenant" means at the constraint level, not just in queries.
  constraint vehicle_has_tenant check (org_id is not null or owner_user_id is not null)
);
create unique index vehicles_vin_per_org on vehicles(org_id, vin) where vin is not null and org_id is not null;
create unique index vehicles_vin_per_user on vehicles(owner_user_id, vin) where vin is not null and owner_user_id is not null;

-- ---------- recorded facts (every row scoped) ----------

create table connections (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade,
  device_kind text,
  elm_version text,
  protocol text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table readings (
  id bigint generated always as identity primary key,
  connection_id uuid not null references connections(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete cascade,
  ts timestamptz not null default now(),
  key text not null,
  value double precision not null
);
create index readings_vehicle_key_ts on readings(vehicle_id, key, ts);
create index readings_connection on readings(connection_id);
-- NOTE at real volume this table wants time-based partitioning (or
-- pg_partman/Timescale) — deferred until there's real multi-user volume,
-- flagged so it isn't forgotten.

create table dtc_scan_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references connections(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete cascade,
  ts timestamptz not null default now(),
  mil_on boolean not null,
  voltage double precision,
  -- freeze_frame, not freeze: FREEZE is a reserved word in Postgres.
  freeze_frame jsonb
);

create table dtc_codes (
  id bigint generated always as identity primary key,
  scan_event_id uuid not null references dtc_scan_events(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete cascade,
  code text not null,
  status text not null check (status in ('stored', 'pending', 'permanent'))
);
create index dtc_codes_event on dtc_codes(scan_event_id);

create table writes_log (
  id bigint generated always as identity primary key,
  connection_id uuid references connections(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete cascade,
  ts timestamptz not null default now(),
  module text not null,
  action text not null,
  params jsonb not null default '{}'::jsonb,
  -- before_state/after_state, matching the SQLite before_json/after_json
  -- intent — avoids leaning on BEFORE/AFTER being merely non-reserved.
  before_state jsonb,
  after_state jsonb,
  outcome text not null,
  error text
);

create table uds_probes (
  id bigint generated always as identity primary key,
  vehicle_id uuid references vehicles(id) on delete cascade,
  module text not null,
  did int not null,
  label text not null,
  unit text not null default '',
  byte_offset int not null default 0,
  len int not null default 1,
  scale double precision not null default 1.0,
  bias double precision not null default 0.0,
  enabled boolean not null default true
);

create table discovered_modules (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  module_address text not null,
  module_name text,
  discovered_at timestamptz not null default now()
);

create table discovered_dids (
  id bigint generated always as identity primary key,
  module_id uuid not null references discovered_modules(id) on delete cascade,
  did int not null,
  raw_sample text,
  byte_length int,
  label text,
  confidence text check (confidence in ('confirmed', 'ai_guess', 'unlabeled')),
  first_seen_at timestamptz not null default now()
);

-- ---------- parts catalog (global reference data, not per-tenant) ----------

create table parts (
  id uuid primary key default gen_random_uuid(),
  oem_ref text,
  name text not null,
  category text,
  notes text
);

create table part_fitments (
  id bigint generated always as identity primary key,
  part_id uuid not null references parts(id) on delete cascade,
  make text not null,
  model text,
  year_from int,
  year_to int,
  engine_code text
);

create table vehicle_parts (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  part_id uuid not null references parts(id) on delete cascade,
  installed_at timestamptz,
  notes text
);

-- ---------- row-level security ----------
-- The tenancy rule, enforced at the database: you see a vehicle iff you own
-- it or you belong to its org; every scoped fact inherits through its
-- vehicle. Unassigned facts (vehicle_id null) are invisible to everyone —
-- device-side data must be claimed to a vehicle before it syncs up.

create or replace function private_is_member_of(check_org uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from org_members m
    where m.org_id = check_org and m.user_id = auth.uid()
  );
$$;

create or replace function private_can_see_vehicle(v_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from vehicles v
    where v.id = v_id
      and (v.owner_user_id = auth.uid() or private_is_member_of(v.org_id))
  );
$$;

alter table organizations enable row level security;
create policy org_visible on organizations for select using (private_is_member_of(id));

alter table org_members enable row level security;
create policy members_visible on org_members for select using (private_is_member_of(org_id));

alter table vehicles enable row level security;
create policy vehicles_select on vehicles for select
  using (owner_user_id = auth.uid() or private_is_member_of(org_id));
create policy vehicles_insert on vehicles for insert
  with check (owner_user_id = auth.uid() or private_is_member_of(org_id));
create policy vehicles_update on vehicles for update
  using (owner_user_id = auth.uid() or private_is_member_of(org_id));

alter table connections enable row level security;
create policy connections_all on connections for all
  using (private_can_see_vehicle(vehicle_id))
  with check (private_can_see_vehicle(vehicle_id));

alter table readings enable row level security;
create policy readings_all on readings for all
  using (private_can_see_vehicle(vehicle_id))
  with check (private_can_see_vehicle(vehicle_id));

alter table dtc_scan_events enable row level security;
create policy dtc_scan_events_all on dtc_scan_events for all
  using (private_can_see_vehicle(vehicle_id))
  with check (private_can_see_vehicle(vehicle_id));

alter table dtc_codes enable row level security;
create policy dtc_codes_all on dtc_codes for all
  using (private_can_see_vehicle(vehicle_id))
  with check (private_can_see_vehicle(vehicle_id));

alter table writes_log enable row level security;
create policy writes_log_all on writes_log for all
  using (private_can_see_vehicle(vehicle_id))
  with check (private_can_see_vehicle(vehicle_id));

alter table uds_probes enable row level security;
create policy uds_probes_all on uds_probes for all
  using (private_can_see_vehicle(vehicle_id))
  with check (private_can_see_vehicle(vehicle_id));

alter table discovered_modules enable row level security;
create policy discovered_modules_all on discovered_modules for all
  using (private_can_see_vehicle(vehicle_id))
  with check (private_can_see_vehicle(vehicle_id));

alter table discovered_dids enable row level security;
create policy discovered_dids_all on discovered_dids for all
  using (exists (select 1 from discovered_modules m where m.id = module_id and private_can_see_vehicle(m.vehicle_id)))
  with check (exists (select 1 from discovered_modules m where m.id = module_id and private_can_see_vehicle(m.vehicle_id)));

-- Parts catalog is shared reference data: readable by any signed-in user,
-- writable only via service role (curation pipeline, later).
alter table parts enable row level security;
create policy parts_read on parts for select using (auth.uid() is not null);
alter table part_fitments enable row level security;
create policy part_fitments_read on part_fitments for select using (auth.uid() is not null);
alter table vehicle_parts enable row level security;
create policy vehicle_parts_all on vehicle_parts for all
  using (private_can_see_vehicle(vehicle_id))
  with check (private_can_see_vehicle(vehicle_id));
