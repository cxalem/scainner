# Adapter selection: landed reconciliation reference

Status: landed on current `main`; this is not an implementation plan. Base:
`origin/main@6a5710e060c885df13306bdb7263b8f8cfdfd5be`.

## What landed

- PRs #85, #86, #87, and #91 provided the adapter picker, device screen, candidate
  discovery, pairing flow, and current `AdapterCandidate` DTO. The current Rust
  candidate carries the legacy `kind`/`id` plus `display_name`, `device_kind`,
  optional `path`/`bt_addr`, and `last_used`; the bridge, schemas, mock, and UI use it.
- The current device screen lists candidates and exposes one device-row Connect
  action. Selection saves the profile and starts connection in the same action;
  there is no separate save step in the current implementation.
- `api::ops::list_adapters` remains the backend source. This does not rewrite history
  as though the old proposal landed verbatim: it supersedes the former UI-1/UI-2 plan.
  No additional UI PR is pre-authorized.

## Windows-relevant contract that remains

The current flow is one tap on a device row: the selected profile is saved and
connection starts immediately. It does not pair Bluetooth devices automatically,
install drivers, or claim a candidate is really an OBD adapter.

The existing profile API/schema includes `pin`, and the current pairing flow can
accept a user-entered PIN after a `pin_required` response. That is existing behavior.
This reconciliation must not widen PIN exposure into candidate rows or new payloads;
any storage or UI-security change is a separate decision.

The remaining Windows expectation is narrow: USB and manually paired Classic
Bluetooth SPP are selectable only when the OS exposes a COM `path`; paired-only
rows remain informational. Keep every visible port because `likely_obd` is only a
hint. Enumeration owns candidate construction, and refresh must not erase saved
profile state or start a connection implicitly.

Remaining Windows work is backend-only: add the pinned Windows serial transport,
then feed Windows COM candidates into this landed surface. A visual or interaction
change requires a concrete current-main defect, a new narrow specification, and approval.

## Superseded proposal

The former UI-1/UI-2 and redacted patch contract were proposals based on an older
base. Current implementation supersedes them; Git history retains their details.
They are not actionable and do not authorize UI work.
