-- Workshop diagnostic cases: the durable repair-order container that spans
-- connections, scans, technician evidence, and eventual pre/post reports.
create table diagnostic_cases (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid unique,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  reference text not null,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting', 'completed', 'cancelled')),
  complaint text not null check (length(btrim(complaint)) > 0),
  odometer_km int check (odometer_km is null or odometer_km >= 0),
  assigned_to text,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (vehicle_id, reference)
);

create index diagnostic_cases_status_updated
  on diagnostic_cases(status, updated_at desc);
create index diagnostic_cases_vehicle_updated
  on diagnostic_cases(vehicle_id, updated_at desc);

alter table diagnostic_cases enable row level security;
create policy diagnostic_cases_all on diagnostic_cases for all
  using (private_can_see_vehicle(vehicle_id))
  with check (private_can_see_vehicle(vehicle_id));
