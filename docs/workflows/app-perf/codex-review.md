# Codex cross-review: app-perf

Reviewer: Codex, 2026-08-20. Independent pass over `main...HEAD` after
the stage-4 review fix commit (`187537f`).

## Verdict: SHIP

I found no blocking correctness defect in the query/cache migration or the
interaction-feedback wiring. The first review's five fixes were real and
are enough to contain the only disabled-query loading bug I found. My
remaining objections are nonblocking follow-ups, not ship blockers.

Verification I ran:

- Read the required workflow docs in order.
- Inspected `git diff main...HEAD` across the query layer, App wiring,
  every migrated view, and the Lab subcomponents.
- Swept the diff for `enabled`, `isPending`, `isFetching`, `useQuery`,
  invalidation, `invoke`, and interactive `onClick` paths.
- Checked Rust command definitions to distinguish SQLite/config reads from
  hardware commands.
- Ran `npx tsc --noEmit`: clean.
- Ran `npx vite build`: clean. Current post-review main chunk is
  `107.97 KB` gzip, with `charts` lazy at `104.89 KB`, `mock` lazy at
  `2.99 KB`, and `VehicleScene` still lazy at `275.01 KB`. The tiny
  `107.95` to `107.97` drift is explained by the stage-4 review's own
  small fix commit; the bundle split claim still holds.

## Answers to carried questions

1. **Ungated queries while disconnected: acceptable.**

   The ungated queries are local database/config reads:
   `report_cars`, `car_report`, `dtc_history`, `reading_keys`, `history`,
   `uds_modules`, `car_info`, `db_path`, and `list_probes`. The Rust
   command bodies confirm these read SQLite or app paths, not the dongle.
   The hardware commands (`all_sensors`, DTC scan/clear, ECU read, UDS
   read/scan/clear) remain manual actions or mutations gated by button
   state. There is no meaningful race with connection state from these
   mount-time queries, and the local IPC cost is acceptable.

2. **Disabled-query `isPending` risk: contained.**

   There are only two disabled query hooks in the diff:
   `useCarReport(vin)` with `enabled: vin != null`, and `useAllSensors()`
   with `enabled: false`. History now guards the disabled
   `useCarReport(null)` case with `firstVin !== null` before counting
   `reportQuery.isPending`. Overview branches before rendering the empty
   state and only reaches `reportQuery.isPending` once `effectiveVin`
   exists. Live uses `isFetching` for the manual `all_sensors` query,
   which is the right flag for a disabled/manual query. I found no missed
   copy of the trap.

3. **Diagnose latest scan lost on tab switch: real behavior, out of this
   stream's implemented scope.**

   The latest scan card is still local component state. A tab switch
   unmounts Diagnose, so that one-shot scan result is lost. That means the
   research table's "history and last scan lost" complaint is only half
   solved: history is now cached; the ephemeral last scan is not.

   I do not count this as a regression or blocker against the plan. The
   plan's query-key list never included `scan_dtcs` as durable readable
   state; it was promoted to a mutation so history/report caches can be
   invalidated. Persisting the latest one-shot result would be a product
   decision, likely a small follow-up using `queryClient.setQueryData`
   under an explicit `latest_scan` key or by deriving the card from
   `dtc_history`.

4. **Blanket invalidation on reconnect: acceptable, with one caution.**

   This does not reintroduce the tab-switch bug. Invalidation is tied to
   `conn-status: connected`, not view remounts or live ticks, and cached
   data remains visible while stale queries refetch. The Rust supervisor can
   emit `connected` again after link-loss recovery, so a very flaky dongle
   can cause repeated bursts. That is still a different trigger class from
   the old every-tab-switch blank/refetch behavior, and the reads being
   invalidated are local DB/config reads. I would ship this and only narrow
   invalidation later if real hardware shows reconnect thrash.

5. **700 ms connect narration: not worth blocking.**

   The 700 ms interval can feel busy during a 20 s real connect because it
   alternates two phrases many times. It is not correctness-risky, and the
   plan explicitly chose timed frontend phrases as a no-Rust stopgap until
   backend progress events exist. Fine to ship. A UX polish follow-up could
   use a slower interval, add a third phrase, or replace the timer with real
   progress events from the supervisor.

6. **Missed correctness defects: none found.**

   I did not find a missed cache-key, stale-data, disabled-query, or
   mutation-feedback bug. Prefix invalidation for `["car_report"]` is
   intentional and covers per-VIN report entries. `scan_dtcs` and
   `clear_dtcs` invalidate both DTC history and reports. Lab module/probe
   mutations invalidate their list queries and surface per-trigger errors.
   Live's manual sensor table correctly survives tab switches from the
   query cache and does not auto-read hardware on mount.

## Nonblocking objections

- Diagnose's latest scan/readiness card still disappears on tab switch.
  This is a legitimate UX gap, but it is separate ephemeral state rather
  than the server-state refetch bug this stream implemented.
- Blanket reconnect invalidation may be noisy on unstable hardware. Keep
  it unless real sessions show repeated reconnect bursts harming UX.
- The 700 ms connect phrase cycle is probably too fast for long real
  hardware connects, but it is harmless and easy to tune later.
- The post-review bundle number should be recorded as `107.97 KB` gzip if
  anyone updates the docs; the original `107.95 KB` was true before the
  review fix commit.
