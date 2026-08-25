-- Evidence-only vehicle map: distinguish first discovery from the latest
-- positive observation of a module. Existing rows inherit discovered_at.
alter table discovered_modules
  add column if not exists last_seen_at timestamptz;

update discovered_modules
set last_seen_at = discovered_at
where last_seen_at is null;

alter table discovered_modules
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null;
