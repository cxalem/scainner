-- Keep cloud idempotency and vehicle ownership aligned with the local v5
-- invariants. All rows sent by the desktop sync already carry vehicle_id.

-- PostgREST emits ON CONFLICT (connection_id, local_id). A partial unique
-- index cannot be inferred by that plain conflict target, so use a full
-- unique index; multiple NULL local_ids remain legal in Postgres anyway.
drop index if exists readings_conn_local;
create unique index readings_conn_local on readings(connection_id, local_id);

-- Natural identities used by the local upsert paths. Enforce them in the
-- database as well so retries or concurrent clients cannot create twins.
create unique index if not exists discovered_modules_vehicle_address
  on discovered_modules(vehicle_id, module_address);
create unique index if not exists discovered_dids_module_did
  on discovered_dids(module_id, did);

-- Discovery provenance exists locally since SQLite v4. Keep the cloud shape
-- compatible before UDS inventory sync is enabled.
alter table uds_probes
  add column if not exists origin text not null default 'manual'
  check (origin in ('manual', 'discovery'));
alter table uds_probes add column if not exists client_uuid uuid unique;
create unique index if not exists uds_probes_vehicle_module_did_origin
  on uds_probes(vehicle_id, module, did, origin);

-- Redundant vehicle_id columns make RLS fast, but they must agree with their
-- parent row. Composite foreign keys make a cross-vehicle association
-- impossible even for a client that can access both vehicles.
alter table connections
  add constraint connections_id_vehicle_unique unique (id, vehicle_id);
alter table dtc_scan_events
  add constraint dtc_scan_events_id_vehicle_unique unique (id, vehicle_id);

alter table readings
  add constraint readings_connection_vehicle_fk
  foreign key (connection_id, vehicle_id)
  references connections(id, vehicle_id) on delete cascade;

alter table dtc_scan_events
  add constraint dtc_scan_connection_vehicle_fk
  foreign key (connection_id, vehicle_id)
  references connections(id, vehicle_id) on delete cascade;

alter table dtc_codes
  add constraint dtc_codes_event_vehicle_fk
  foreign key (scan_event_id, vehicle_id)
  references dtc_scan_events(id, vehicle_id) on delete cascade;

alter table writes_log
  add constraint writes_connection_vehicle_fk
  foreign key (connection_id, vehicle_id)
  references connections(id, vehicle_id) on delete cascade;

-- Security-definer helpers must never inherit a caller-controlled search
-- path. Qualify every relation and pin the function to an empty path.
create or replace function public.private_is_member_of(check_org uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = check_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.private_can_see_vehicle(v_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.vehicles v
    where v.id = v_id
      and (v.owner_user_id = auth.uid() or public.private_is_member_of(v.org_id))
  );
$$;
