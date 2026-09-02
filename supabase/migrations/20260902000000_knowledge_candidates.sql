create table knowledge_candidates (
  id uuid primary key,
  contributor_user_id uuid not null references auth.users(id) on delete cascade,
  compatibility_key text not null,
  scope text not null check (scope in ('ecu_family', 'exact_ecu', 'observation')),
  family_id text,
  module_address text not null,
  supplier text,
  spare_part_number text,
  hardware_version text,
  software_version text,
  system_name text,
  route jsonb,
  did int not null,
  payload_length int,
  knowledge_state text not null default 'unknown',
  label text,
  decode jsonb,
  shape jsonb,
  interpretations jsonb,
  confidence double precision,
  discriminating_test text,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  unique (contributor_user_id, compatibility_key, did)
);

create index knowledge_candidates_family_did
  on knowledge_candidates(family_id, did);

alter table knowledge_candidates enable row level security;
create policy knowledge_candidates_select on knowledge_candidates for select
  using (auth.uid() is not null);
create policy knowledge_candidates_insert on knowledge_candidates for insert
  with check (contributor_user_id = auth.uid());
create policy knowledge_candidates_update on knowledge_candidates for update
  using (contributor_user_id = auth.uid())
  with check (contributor_user_id = auth.uid());
create policy knowledge_candidates_delete on knowledge_candidates for delete
  using (contributor_user_id = auth.uid());

alter table discovered_modules
  add column if not exists route jsonb,
  add column if not exists family_id text,
  add column if not exists route_state text,
  add column if not exists supplier text;

alter table discovered_dids drop column if exists raw_sample;
alter table discovered_modules drop column if exists fingerprint_evidence;
