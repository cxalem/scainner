# Interaction-feedback audit

Extends `research.md`/`plan.md` (loading, caching, skeletons, bundle). Does
not repeat that work — different axis: for every interactive element, does
pressing it give the user any signal, during the wait, and after. Method:
grepped every `onClick`, `onChange`, `<input`, `<button`/`<Button`, and
every `invoke(...)` call site under `src/`.

## Inventory

Latency class: **instant** = local SQLite read/write (near-zero on real
Tauri IPC). **slow-hw** = a real dongle round trip (seconds, sometimes
20s+). **network** = Anthropic API call from the browser (10-60s). **sync**
= no `invoke`, pure client state. Press = feedback the instant you click,
before any async result.

| View | Element | Command | Latency | Press | Pending | Success | Failure |
|---|---|---|---|---|---|---|---|
| Shell | Nav buttons (6) | — | sync | hover/focus only | n/a | view swaps | n/a |
| Shell | Connect | `connect` | slow-hw | hover/focus only | label "Connecting…", disabled, dot pulses | dot solid | `conn.detail`, disconnected only |
| Shell | Disconnect | `disconnect` | slow-hw | hover/focus only | **none** | dot/status update | none |
| ConnectGate | Connect | `connect` | slow-hw | hover/focus only | label "Connecting…", disabled | gate unmounts | `conn.detail` text |
| DiscoveryFlow | Go to dashboard | — | sync | hover/focus only | n/a | overlay closes | n/a |
| Overview | Car VIN select | `car_report` | instant | n/a | **none — old report stays on screen** | new report replaces old | swallowed |
| Overview | Fuel price "save" | `set_fuel_price` | instant | hover/underline | **none** | numbers update after refetch | **none, no `.catch`** |
| Live | Gauges/table toggle | — | sync | pressed bg change | n/a | instant swap | n/a |
| Live | Read all sensors | `all_sensors` | slow-hw ~15s | hover/focus only | spinner + "Interrogating ECU…", disabled | table + timestamp | inline red box |
| Live | Filter input | — | sync | n/a | n/a | list filters live | n/a |
| History | Sensor select | `history` | instant | n/a | "loading…" text, chart stays blank/stale | chart redraws | swallowed, empty |
| History | Range buttons | `history` | instant | active bg only | same as above | same | same |
| History | 7d/All segmented | — | sync | bg change | n/a | table swaps | n/a |
| Diagnose | Scan for codes | `scan_dtcs` | slow-hw | hover/focus only | spinner + "Scanning…", disabled | scan card renders | inline red box |
| Diagnose | Yes, clear | `clear_dtcs`+`scan_dtcs` | slow-hw ×2 | hover/focus only | **none — button stays clickable** | banner after both resolve | inline red box |
| Diagnose | Cancel clear | — | sync | hover/focus only | n/a | banner closes | n/a |
| Diagnose | Code badge → modal | — | sync | hover scale-105 (best in app) | n/a | modal opens | n/a |
| Diagnose | AI deep-dive (code) | `ai_context`+fetch | network | hover/focus only | label "Analyzing…", pulse icon, disabled | report renders | inline red box |
| Diagnose | Generate report | `ai_context`+fetch | network | hover/focus only | label "Analyzing…", pulse icon, disabled | report renders | inline red box |
| Diagnose | Copy AI report | clipboard | instant | hover/focus only | n/a | label "Copied" 1.5s (best success pattern) | silent on throw |
| Diagnose | API key save/change | localStorage | sync | hover/focus only | n/a | form swaps | n/a |
| Vehicle | Read from ECU | `read_ecu_info` | slow-hw | hover/focus only | **none at all — no spinner, label, or disable** | rows populate | swallowed (empty catch) |
| Vehicle | Copy AI briefing | `ai_context`+clipboard | instant | hover/focus only | none (fast enough) | label "Copied…" 2.5s | unhandled on throw |
| Vehicle | Raw JSON 24h/30d | `export_json`+clipboard | instant | hover/focus only | none, no disable (double-click risk) | label "Copied" 2.5s | unhandled on throw |
| Lab | Module select | — | sync | n/a | n/a | cards re-key | n/a |
| Lab/ModuleManager | Add → Save/Cancel | `add_uds_module` | instant | hover/focus only | **none — no disable while saving** | list refreshes, form closes | inline red text |
| Lab/ModuleManager | remove (link) | `delete_uds_module` | instant | hover/underline | **none** | list refreshes | **unhandled, no try/catch** |
| Lab/DidReader | Read | `uds_read` | slow-hw | hover/focus only | label "Reading…", disabled | hex/ascii box | inline red text |
| Lab/RangeScanner | Scan | `uds_scan` (chunked) | slow-hw, long | hover/focus only | **live progress bar + per-DID narration via event + running hit count — best pattern in the app** | hit table + summary | inline text, cancel handled |
| Lab/RangeScanner | Cancel scan | `uds_cancel_scan` | instant signal | hover/focus only | covered by scan's busy state | progress stops, hits kept | n/a |
| Lab/RangeScanner | → probe (per hit) | — | sync | hover/underline | n/a | opens draft | n/a |
| Lab/ProbeManager | Save probe | `add_probe` | instant | hover/focus only | **none** | list refreshes, form closes | **unhandled, no try/catch** |
| Lab/ProbeManager | enable/disable | `toggle_probe` | instant | hover/underline | **none** | label flips after reload | **unhandled, no try/catch** |
| Lab/ProbeManager | delete | `delete_probe` | instant | hover/underline | **none** | row disappears | **unhandled, no try/catch** |
| Lab/ModuleFaults | Read faults | `uds_module_dtcs` | slow-hw | hover/focus only | spinner + "Reading…", disabled | code chips render | inline red text |
| Lab/ModuleFaults | Yes, clear (module) | `uds_clear` | slow-hw | hover/focus only | `busy` → "Clearing…" spinner (correct, unlike Diagnose's clear) | outcome banner | inline red text |
| Lab/ModuleFaults | Cancel clear | — | sync | hover/focus only | n/a | banner closes | n/a |

## Worst offenders (longest real wait, least signal)

1. **Diagnose "Yes, clear"** — two chained slow-hardware calls, button
   stays clickable, nothing changes on screen until the banner appears.
   Worst case: a destructive action with no acknowledgment it fired.
2. **Vehicle "Read from ECU"** — one slow-hardware call, zero feedback of
   any kind, not even a label change.
3. **Connect (ConnectGate + Shell)** — often the slowest single action on
   real hardware (adaptive Bluetooth ladder can retry). Only signal is a
   text swap to "Connecting…", no phase narration.
4. **AI report generation (2 call sites)** — the longest real waits in the
   app (10-60s), fed by a static "Analyzing…" label and a pulsing icon.
5. **Live "Read all sensors"** — ~15s of hardware time, spinner only,
   while `RangeScanner` two tabs over already proves per-item live
   progress works in this codebase.
6. **Lab write actions with zero error handling** — `RemoveModuleButton`
   and `ProbeManager`'s save/toggle/delete have no `try`/`catch` at all: a
   failed write is an unhandled promise rejection, never shown to the user.

## Standard interaction-feedback rules (for the plan amendment)

1. Every `Button` that triggers `invoke` disables and shows a distinct
   pending label/icon while in flight, no exceptions. Today `Disconnect`,
   Vehicle's "Read from ECU", Diagnose's clear flow, and every Lab
   list-mutation button skip this.
2. Every `invoke` in an event handler gets a `.catch`/try-catch that
   renders visibly near the trigger, reusing the existing
   `border-destructive/30 bg-destructive/10` box. Swallowed catches stay
   acceptable only for background/mount fetches already covered by the
   plan's `isError` skeleton, never for a user-triggered action.
3. Pending UI by latency class: *instant* needs at least disable + slight
   opacity dip (it's a measured average, not a guarantee). *slow-hw*
   (2s+) needs a visible spinner and a changing status label, same bar
   `RangeScanner` clears; anything expected to run long also gets step
   narration (rule 5). *network* (10-60s) needs more than a static label —
   cycle it through 2-3 phrases over time ("Sending briefing…" → "Waiting
   for the model…" → "Writing report…") so a 40s wait doesn't read frozen.
4. Every success that changes data shows a visible confirmation. If the
   changed value is already on screen (a report refetching), that is
   enough. If not (fuel price saved, probe toggled, module removed off
   screen), reuse the existing transient "label flips to 'Saved'/'Copied'
   for ~2s" pattern from `AiReportCard`'s Copy and Vehicle's export
   buttons — don't invent a new one.
5. Generalize `DiscoveryFlow`'s and `RangeScanner`'s progress narration to
   the other slow-hardware actions: a short present-tense phrase that
   changes as the operation moves through real phases, via sequential
   await boundaries (`DiscoveryFlow`'s shape) or a backend progress event
   (`RangeScanner`'s `uds-scan-progress`). Apply to `connect` ("Waking the
   dongle…" → "Negotiating protocol…"), and check whether `all_sensors`
   can emit the same kind of progress event the backend already uses for
   UDS range scans, since it also sweeps sensor-by-sensor.
6. Add a real `:active` state to the shared `Button`, `Segmented`, and
   nav-item classes (e.g. `active:scale-[0.98]`) so every click gets
   immediate tactile response independent of how long the work takes.
   Nothing in the app has a press state today, hover/focus-visible only —
   including instant, sync-only controls like nav where a fix costs
   nothing.
7. Stale-data guard: switching Overview's VIN selector must not leave the
   previous car's report on screen during the new fetch. Once wrapped in
   `useQuery`, don't opt into `placeholderData`/`keepPreviousData` for
   `["car_report", vin]` — let it fall back to the skeleton on key change.

## Already covered by `plan.md` vs genuinely new

**Already covered, not re-planned:** the "no data" vs "still loading"
conflation (Overview, Vehicle Identity, History's chart/stats/sessions);
History's `"loading…"` text and layout jump; Live's sensor table lost on
tab switch; Overview not refreshing after discovery without a manual step;
`read_ecu_info` invalidating `car_info` in cache. That last one is only
half-covered: the plan wires the data refresh, not the button's own
spinner — the spinner is new (rule 1).

**Genuinely new:** press/active feedback for instant and sync interactions
(rule 6) is outside the plan's server-state scope entirely. `connect`/
`disconnect` aren't Tauri reads and aren't in the plan's query-key list.
AI report generation (`src/lib/ai.ts`) calls `fetch` directly to
Anthropic, bypassing `invoke` and the plan's Tauri-command scope, while
being the slowest, least-narrated action in the app. The missing
`try`/`catch` on several Lab write handlers (rule 2) is a correctness gap
the plan's `isError` pattern doesn't touch (that's for `useQuery` reads).
Diagnose's `doClear` and Vehicle's `readEcu` having no pending UI at all —
`useMutation` will hand back `isPending` "for free," but `plan.md` never
says to wire it to the button visually; this amendment should make that an
explicit step.
