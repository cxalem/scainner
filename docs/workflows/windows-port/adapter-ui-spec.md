# Specification: adapter selection

Status: proposed for the SCAINNER-01 human gate. Base: `origin/main@c612e1b`.
This specification completes the optional user-ready UI path in `plan.md`; it does
not authorize implementation.

## Verified boundary

- `api::ops::{list_adapters,adapter_profile,set_adapter_profile}` already contain
  the reusable Rust operations. Only the local HTTP API exposes them today.
- Tauri's `generate_handler!` list has no adapter commands. `DeviceService`,
  `DeviceServiceLive` and `mock.ts` have no corresponding methods.
- `ConnectGate` implements the disconnected experience. Connect is its primary action;
  Browse offline and post-connect continuation also exist. `docs/product/ui-flow-spec.md`
  already calls for a secondary Choose adapter action while disconnected.
- The current candidate DTO overloads `id`: a serial candidate uses a port path,
  while a Bluetooth candidate uses a MAC. That is not a safe UI selection contract
  because an `elm_serial` profile always needs a path.

## Product contract

The picker answers one question: which already-visible ELM-compatible connection
should Scainner try? It does not pair Bluetooth devices, install drivers or claim a
candidate is really an OBD adapter.

- Open from ConnectGate while disconnected. Do not permit profile mutation during
  connecting or connected states.
- Show likely OBD candidates first without hiding unknown ports. Label the heuristic
  as a hint, not compatibility proof.
- Selecting a serial or Windows SPP candidate saves its port path. A paired Bluetooth
  row without a corresponding serial path is informational and explains that system
  pairing must expose a port before it can be selected.
- Offer Wi-Fi as an explicit alternative with host and port. Never silently replace
  a saved serial profile because no port happens to be visible now.
- Put baud, timing and Bluetooth MAC under Connection details. Do not return, display
  or accept the persisted Bluetooth PIN through the shared/Tauri UI contract. Its
  storage is a separate security gate below. Preserve unrelated saved values.
- Save first, show the validated stored profile, then let the user press Connect.
  Backend validation errors remain actionable and no connection starts implicitly.
- Provide loading, zero-candidate, refresh, save-error and saved states. Keyboard
  focus returns to Choose adapter when the dialog closes; status changes use a live
  region without announcing every decorative transition.

## Exact Tauri contract

Tauri commands use camelCase arguments and bare decoded results:

```text
list_adapters() -> AdapterCandidate[]
get_adapter_profile() -> AdapterProfileView
patch_adapter_profile({ patch: AdapterProfilePatch }) -> AdapterProfileView

AdapterCandidate = {
  source: "serial" | "bluetooth" | "unknown",
  path: string | null, bt_addr: string | null, name: string,
  likely_obd: boolean, connected: boolean | null
}
AdapterProfileView = {
  kind: "elm_serial" | "tcp_elm", path: string | null,
  bt_addr: string | null, host: string | null, port: number,
  baud: number, timing: "fast" | "default" | "slow",
  pin_configured: boolean
}
AdapterProfilePatch = Partial<Omit<AdapterProfileView, "pin_configured">>
```

The Tauri list is a bare array; the existing HTTP endpoint may keep its
`{ "adapters": [...] }` envelope. Null means unavailable/not supplied, never empty
string. Windows USB and manual SPP rows are selectable only with a COM `path`; SPP may
have `source: "bluetooth"` while `bt_addr` stays null. A macOS paired-device row may
carry `bt_addr` with null `path` and is informational until a serial node is visible.
Do not infer whether a value is a path or MAC from `source`. The enumeration stream
owns the Rust candidate DTO; the bridge derives schemas only after that DTO lands.

## Ordered documentation-approved PRs

### UI-1: adapter bridge and contracts

Boundary:

- `apps/desktop/src-tauri/src/lib.rs` for three thin Tauri commands over `api::ops`;
- `apps/desktop/src-tauri/src/api/ops.rs` and `elm/transport/profile.rs` for a
  non-secret patch path that writes only changed non-PIN settings;
- `packages/core/src/schema/adapter.ts` and its export barrel;
- `packages/core/src/services/device-service.ts`;
- `apps/desktop/src/core/services/device-service-live.ts`;
- `apps/desktop/src/lib/mock.ts` and focused contract tests.

Acceptance: each command decodes its exact result schema; omitted fields are preserved
and explicit null clears an optional field. With `SCAINNER_OBD_PIN` set and no stored
PIN, a non-secret patch leaves `adapter.pin` absent from SQLite; a pre-existing stored
PIN remains byte-identical. Invalid combinations fail. The mock covers zero/multiple
candidates, serial and Wi-Fi. New adapter files import neither raw Tauri nor the local
HTTP API. No UI-facing value or mock contains `pin`.

### UI-2: Choose adapter interaction

Boundary:

- a new component beside `ConnectGate.tsx` and the minimal ConnectGate integration;
- adapter query/mutation helpers under the connection feature;
- `i18n/{dictionary,en,es}.ts`;
- pure picker-state/helper tests and `README.md` truthfulness update.

Use existing `Dialog`, `Button`, form primitives, brand tokens and motion recipes.
Do not create a dashboard-style settings page, generic form framework or new visual
language.

Acceptance: Node Vitest covers state transitions, DTO-to-row mapping and patch
construction. A targeted browser mock review records screenshots and keyboard/focus
evidence in the PR because this repo has no DOM component-test harness. Selecting and
saving changes the displayed profile; refresh never erases it; Connect is unchanged;
English and Spanish contain no hardcoded view copy.

## Human decisions

1. Include both UI PRs in SCAINNER-01 before using the phrase user-ready Windows?
   Recommendation: yes.
2. Expose Connection details in v1 or limit the UI to candidate/Wi-Fi selection?
   Recommendation: keep a collapsed advanced section so existing profile capability
   is not lost.
3. Make the picker cross-platform now? Recommendation: yes; the missing UI is already
   a macOS/Linux product gap and the same contracts avoid a Windows-only fork.
4. Does Alejandro classify the pairing PIN as a secret under `engineering.md`?
   Recommendation: yes. Commission a separate secret-storage research/plan stream
   before any UI can read or change it; the two UI PRs above keep it redacted and do
   not expand the current SQLite/HTTP exposure. An explicit exception is Alejandro's
   decision, not a builder assumption.

## Hardware wall

No scanner is needed for DTO/schema tests, Tauri wrapper tests, mock interaction,
validation errors, accessibility, i18n or visual review. A physical adapter is still
required to prove that the selected USB/SPP/Wi-Fi profile opens, survives reconnect,
identifies through `ATI`/`STI`, and remains stable during a real diagnostic session.
