-- Partial ISO 14229 identity fingerprints. These are private operational
-- observations attached to a vehicle/module; promotion into shared knowledge
-- remains a later, reviewed process.
alter table discovered_modules
  add column if not exists spare_part_number text,
  add column if not exists hardware_version text,
  add column if not exists software_version text,
  add column if not exists system_name text,
  add column if not exists fingerprint_match_key text,
  add column if not exists fingerprint_evidence jsonb;

create index if not exists discovered_modules_fingerprint_match
  on discovered_modules(fingerprint_match_key)
  where fingerprint_match_key is not null;

comment on column discovered_modules.fingerprint_match_key is
  'Canonical ECU-family identity fields; excludes VIN and ECU serial number.';
comment on column discovered_modules.fingerprint_evidence is
  'Per-DID answered/refused/unsupported/timed-out evidence for the partial fingerprint.';
