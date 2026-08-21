-- Sync-engine support: idempotency targets so the desktop app's push loop
-- can retry any batch safely (docs/workflows/data-core/plan.md, sync
-- section). vehicles/connections/dtc_scan_events already take
-- client-generated uuids as their primary keys; the two high/append-volume
-- tables get explicit conflict targets instead.

-- readings: the client ships its local SQLite rowid; (connection, local_id)
-- is unique per source device's connection, so a re-pushed batch upserts to
-- nothing instead of duplicating.
alter table readings add column local_id bigint;
create unique index readings_conn_local on readings(connection_id, local_id) where local_id is not null;

-- writes_log: low volume, client ships a uuid per row.
alter table writes_log add column client_uuid uuid unique;

-- dtc_codes: a scan event can only list a given (code, status) once.
create unique index dtc_codes_unique_per_event on dtc_codes(scan_event_id, code, status);
