create table rides (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  connection_id uuid not null references connections(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  start_reading_id bigint,
  end_reading_id bigint,
  sample_count int not null default 0 check (sample_count >= 0),
  sensor_count int not null default 0 check (sensor_count >= 0),
  dtc_events_count int not null default 0 check (dtc_events_count >= 0),
  dtc_codes_appeared int not null default 0 check (dtc_codes_appeared >= 0),
  max_speed double precision,
  max_coolant double precision,
  min_voltage double precision,
  notes text,
  unique (id, user_id)
);

create index rides_user_started on rides(user_id, started_at desc);
create index rides_connection_window on rides(connection_id, started_at, ended_at);

create table report_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text unique,
  status text not null,
  plan text not null,
  monthly_allowance int not null default 0 check (monthly_allowance >= 0),
  allowance_used int not null default 0 check (allowance_used >= 0),
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  check (allowance_used <= monthly_allowance)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('ride', 'code')),
  ride_id uuid references rides(id) on delete set null,
  scan_event_id uuid references dtc_scan_events(id) on delete set null,
  dtc_code text,
  locale text not null check (locale in ('en', 'es')),
  status text not null check (status in ('queued', 'running', 'done', 'failed', 'refused')),
  model text not null,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_creation_tokens int,
  cost_usd numeric(10,6),
  content_md text,
  summary jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (
    (kind = 'ride' and ride_id is not null and scan_event_id is null and dtc_code is null)
    or (kind = 'code' and ride_id is null and scan_event_id is not null and dtc_code is not null)
  )
);

create index reports_user_created on reports(user_id, created_at desc);

create table stripe_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique
);

create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta int not null,
  reason text not null check (reason in ('purchase', 'subscription_grant', 'report', 'refund', 'adjustment')),
  stripe_event_id text unique,
  report_id uuid references reports(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index credit_ledger_report_charge on credit_ledger(report_id)
  where reason = 'report';
create unique index credit_ledger_report_refund on credit_ledger(report_id)
  where reason = 'refund';

create or replace function consume_report_credit(p_user uuid, p_report uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  used_subscription boolean;
  used_credit boolean;
begin
  if p_user <> auth.uid() and auth.role() <> 'service_role' then
    raise exception 'not authorized';
  end if;

  if not exists (
    select 1 from public.reports
    where id = p_report and user_id = p_user and status = 'queued'
  ) then
    raise exception 'report is not queued for this user';
  end if;

  update public.subscriptions
  set allowance_used = allowance_used + 1, updated_at = now()
  where user_id = p_user
    and status in ('active', 'trialing')
    and (current_period_end is null or current_period_end > now())
    and allowance_used < monthly_allowance
  returning true into used_subscription;

  if coalesce(used_subscription, false) then
    insert into public.credit_ledger(user_id, delta, reason, report_id)
    values (p_user, 0, 'report', p_report);
    return 'subscription';
  end if;

  update public.report_credits
  set balance = balance - 1, updated_at = now()
  where user_id = p_user and balance > 0
  returning true into used_credit;

  if coalesce(used_credit, false) then
    insert into public.credit_ledger(user_id, delta, reason, report_id)
    values (p_user, -1, 'report', p_report);
    return 'credit';
  end if;

  return 'none';
end;
$$;

create or replace function refund_report_credit(p_user uuid, p_report uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  charge_delta int;
begin
  if p_user <> auth.uid() and auth.role() <> 'service_role' then
    raise exception 'not authorized';
  end if;

  select delta into charge_delta
  from public.credit_ledger
  where user_id = p_user and report_id = p_report and reason = 'report'
  for update;

  if charge_delta is null or exists (
    select 1 from public.credit_ledger where report_id = p_report and reason = 'refund'
  ) then
    return false;
  end if;

  if charge_delta = 0 then
    update public.subscriptions
    set allowance_used = greatest(allowance_used - 1, 0), updated_at = now()
    where user_id = p_user;
  else
    insert into public.report_credits(user_id, balance)
    values (p_user, 1)
    on conflict (user_id) do update
      set balance = public.report_credits.balance + 1, updated_at = now();
  end if;

  insert into public.credit_ledger(user_id, delta, reason, report_id)
  values (p_user, -charge_delta, 'refund', p_report);
  return true;
end;
$$;

revoke all on function consume_report_credit(uuid, uuid) from public;
revoke all on function refund_report_credit(uuid, uuid) from public;
grant execute on function consume_report_credit(uuid, uuid) to authenticated, service_role;
grant execute on function refund_report_credit(uuid, uuid) to service_role;

alter table rides enable row level security;
create policy rides_select on rides for select using (user_id = auth.uid());

alter table report_credits enable row level security;
create policy report_credits_select on report_credits for select using (user_id = auth.uid());

alter table credit_ledger enable row level security;
create policy credit_ledger_select on credit_ledger for select using (user_id = auth.uid());

alter table subscriptions enable row level security;
create policy subscriptions_select on subscriptions for select using (user_id = auth.uid());

alter table reports enable row level security;
create policy reports_select on reports for select using (user_id = auth.uid());

alter table stripe_customers enable row level security;
create policy stripe_customers_select on stripe_customers for select using (user_id = auth.uid());

alter table stripe_events enable row level security;
