# Current UI map (as built, 2026-08-29)

What's actually shipped in `apps/desktop/src` today — every tab, every card, and
where it gets its data — plus the duplicated features and state-management
issues found while mapping it. This is a snapshot of the *current* app, not
the `ui-flow-spec.md` redesign; see that document for where things are headed.

## 1. App shell (`App.tsx` + `components/Shell.tsx`)

Gate sequence before any tab is visible:

1. **Onboarding gate** (`components/OnboardingGate.tsx`) — once ever per
   install (persisted in `lib/onboarding.ts`). Language confirmation only.
2. **Connect gate** (`components/ConnectGate.tsx`) — shown until the first
   successful connect of the app session (`hasConnectedOnce`, session-only,
   not persisted). One Connect button, optional email OTP sign-in.
3. **Discovery flow overlay** (`components/DiscoveryFlow.tsx`) — full-screen,
   shown once per never-before-seen VIN. Replays the backend's own steps
   (identity read, then sensor sweep + fault check) rather than a canned
   animation.

Once past those, `Shell.tsx` renders a fixed sidebar (logo, vehicle switcher,
nav, locale toggle, connection card) and a scrollable content area for
whichever tab is active.

**Nav — seven tabs, two groups:**

| Group | Tabs |
|---|---|
| Primary | Workshop, Overview, Live, History, Diagnose |
| Advanced (divider above) | Lab, Vehicle |

**Vehicle switcher**: appears only when the DB holds >1 vehicle, or none is
connected. Selecting a car that isn't the physically-connected one puts every
tab into **archive mode** — a banner ("browsing X, not connected") plus a
"return to connected" button — computed once in `lib/vehicle-view.ts`
(`resolveVehicleView`) and passed down as `liveEnabled`/`viewVehicleId` so no
tab can send a live command to a car that isn't plugged in.

## 2. Tab-by-tab

### Workshop *(primary, `views/Workshop.tsx`)*
Shop-style case tracking, not a car view. Create a "diagnostic case" against
a vehicle (complaint, odometer, technician), list open/closed cases.
Data: `features/workshop/cases.ts` (`useDiagnosticCases`, `useCreateDiagnosticCase`).

### Overview *(primary, default tab, `views/Overview.tsx`)*
The dashboard: 3D brand-emblem scene (`components/VehicleScene.tsx`, lazy),
stat tiles (sessions, engine time, readings, scan pass rate), fuel card
(`views/overview/FuelCard.tsx`), and verdict summaries
(`views/overview/buildVerdicts.ts`). Handles distinct empty/error states:
no vehicles yet, connected-but-unidentified (prompts a name), failed loads.
Data: `features/vehicle/queries.ts` (`useVehicles`, `useVehicleReport`,
`useNameCurrentVehicle`).

### Live *(primary, `views/Live.tsx`)*
Streaming gauges from the `live-update` event (pushed into `App.tsx` state,
passed down as `live: LiveMap`), a fixed grid of known PIDs
(`shared/domain/gauges.ts`) plus a "discovered sensors" section for anything
outside that fixed set. Below: an "All sensors" one-shot read-everything
table with a filter box (`features/live/queries.ts`, `useAllSensors`).

### History *(primary, `views/History.tsx`)*
Trend chart (lazy recharts, `components/charts.tsx`) for one selected sensor
over a time range, plus a min/avg/max table (7d / all-time).
Data: `features/history/queries.ts` (`useReadingKeys`, `useHistoryPoints`),
`features/vehicle/queries.ts` (`useVehicleReport` for the stats table).

### Diagnose *(primary, `views/Diagnose.tsx`)*
The core loop. `views/diagnose/ScanConsole.tsx` — fixed-height workspace:
scan → read DTCs → clear → rescan. Supporting cards: `CodeStatusSection`,
`FreezeFrame`, `VoltageClusterNote` (a narrow, inspectable heuristic — not a
hidden reclassification), a readiness-monitor card, and `AiReportCard.tsx`
(sends a backend-built briefing to the Anthropic API with the user's own key).
Data: `features/diagnose/queries.ts` (`useDtcHistory`, `useScanDtcs`,
`useClearDtcs`, `useWritesLog`). Clearing goes through the shared
`components/ConfirmWrite.tsx` safety rail.

### Lab *(advanced, `views/Lab.tsx`)*
Manufacturer-specific UDS diagnostics, module-scoped. Ordered auto-first,
manual-second:
- **AutoDiscovery** — one-button sweep of modules/DIDs the knowledge map
  already documents for this VIN; full decodes promote straight into Live.
- **ParkedVerification** — runs the backend-generated verification plan,
  shows per-target answered/refused/timed-out results with raw payloads.
- **GuidedCorrelation** — "human as actuator": one instruction at a time,
  diffs before/after to say what changed.
- *Advanced drawer*: **ModuleManager** (add a custom module), **DidReader**
  (read one DID by hand), **RangeScanner** (sweep a DID range), **ProbeManager**
  (promote a scan hit to a polled sensor), **ModuleFaults** (per-module fault
  read/clear, verified before/after, also through `ConfirmWrite`).
Data: `features/lab/queries.ts`, plus `views/lab/plan.ts`
(`useParkedPlan`, `useGuidedSteps` — both backend-generated, no car traffic).

### Vehicle *(advanced, `views/Vehicle.tsx`)*
Identity card (VIN, make/model/year, name, first-connected — with a manual
"read from ECU" refresh), `VehicleEvidenceMap` (shows *where* each identity
fact came from: ECU-reported / ECU identity block / documented profile — no
guesses presented as facts), a data-export card (DB path, AI briefing copy,
raw JSON 24h/30d), and `AccountSyncCard` (email-OTP sign-in + cloud sync
status — parked here only because there's no Settings surface yet).
Data: `features/vehicle/queries.ts` (`useVehicleInfo`, `useVehicleEvidenceMap`,
`useDbPath`, `useReadEcuInfo`).

## 3. Duplicated features

### 3.1 Four separate "scan the car" entry points
| Entry point | Surface | Trigger | Backend call |
|---|---|---|---|
| `DiscoveryFlow.tsx` | full-screen overlay | automatic, once per new VIN | `readEcuInfo` + `scanDtcs` |
| `AutoDiscovery.tsx` | Lab card | manual button | `discoverSensors` |
| `ParkedVerification.tsx` | Lab card | manual button | backend-generated plan run |
| `GuidedCorrelation.tsx` | Lab card | manual, step-by-step | guided-step tree |

Each calls a genuinely different backend capability, so this isn't dead code
— but it is the exact button-sprawl already flagged in product review
("in the lab tab we have multiple buttons to scan"). `ui-flow-spec.md`'s
B1/B2/B3 split is the fix already scoped for this; it hasn't landed in the
app yet.

### 3.2 Two independently-built fault-code flows
- **Diagnose** (`ScanConsole.tsx` + `features/diagnose/queries.ts`): standard
  OBD-II DTCs, state lives in TanStack Query (`useScanDtcs`/`useClearDtcs`
  mutations, `dtc_history` cache).
- **Lab** (`ModuleFaults.tsx:22`): manufacturer UDS faults per-module, same
  read → confirm → clear → re-read shape, but hand-rolled with local
  `useState<string | null>` busy flags and a raw `DeviceService.udsClear`
  call instead of a query hook.

Same feature shape, two different plumbing styles. Both correctly route the
actual write through the shared `ConfirmWrite`/`WriteHistory` components, so
the *safety rail* isn't duplicated — only the read/clear state machine is.

### 3.3 "Busy button" state reimplemented per view
`components/ui.tsx` already exports `useCyclingLabel` and `useTransientLabel`
as shared async-button primitives, but every view still pairs them with its
own hand-rolled busy flag rather than a shared hook:
- `views/Vehicle.tsx:42` — `copyingWhich: string | null` for 3 export buttons
  (explicitly commented as "a deliberate simplification" over per-button state)
- `views/lab/ModuleFaults.tsx:22`, `views/lab/DidReader.tsx:17`,
  `views/lab/RangeScanner.tsx:46` — each its own `busy` state of a slightly
  different shape (`string | null` vs plain `boolean`)
- `views/diagnose/AiReportCard.tsx`, `views/overview/FuelCard.tsx` — each
  their own `useTransientLabel()` call

Not wrong individually, but five near-identical "which button is spinning"
implementations with no shared hook above the label-flash primitive.

## 4. State-management issues

### 4.1 Confirmed bug — stale query key breaks Overview refresh
`features/diagnose/queries.ts:40` and `:57` invalidate
`queryKey: ["car_report"]` on DTC scan and clear. No query anywhere is keyed
`car_report` — the actual vehicle-report query
(`features/vehicle/queries.ts:26`, consumed by Overview's stat tiles and
History's stats table) is keyed `["vehicle_report", vehicleId]`. This is a
leftover from before the schema-v2 rename (`car_report` → `vehicle_report`)
that was never updated at the call site.

**Effect**: scanning or clearing DTCs does not refresh Overview's
`scans_clean`/`scans_total` tile or any other `vehicle_report` consumer. It
only catches up incidentally, via `App.tsx`'s "invalidate everything on
connect" on the *next* reconnect — not right after the scan/clear that
should have changed it.

**Fix**: change both invalidations to `queryKey: ["vehicle_report"]`.

### 4.2 "Which vehicle to show" resolved three different ways
- **App.tsx** (`lib/vehicle-view.ts:25`, `resolveVehicleView`) is the one
  place meant to own this: connected vehicle wins when connected, otherwise
  the sidebar-selected vehicle, with `liveEnabled` gating whether the current
  view may act on the car. This is passed down as `vehicleId` to every tab.
- **Overview.tsx** ignores that and keeps its *own* parallel
  `useState<number | null>(connectedVehicleId)` (`views/Overview.tsx:52`)
  with its own effect that, while disconnected, defaults to
  `vehicles[0].id` (`views/Overview.tsx:68`) — its own local vehicle picker,
  separate from the sidebar switcher, with a fallback rule App.tsx doesn't
  apply anywhere else.
- **History.tsx** has a *third*, differently-written version of the same
  fallback inline: `connectedVehicleId ?? vehiclesQuery.data?.[0]?.id ?? null`
  (`views/History.tsx:108`).
- **Diagnose.tsx**, **Vehicle.tsx**, **Lab.tsx** do none of this — they just
  trust the `vehicleId` prop from `App.tsx` as-is, showing nothing until a
  vehicle is actually selected.

**Effect**: with no car connected and no explicit sidebar selection,
Overview and History silently show "the first vehicle in the list" while
Diagnose/Vehicle/Lab show an empty state. Same app, three different
disconnected-state behaviors for what should be one rule. Overview also has
its own vehicle `<select>` in the page header (`views/Overview.tsx` render,
separate from the sidebar switcher) — two vehicle pickers can be visible on
screen at once when Overview is active and the DB has >1 car.

**Fix direction**: fold the "no connection, default to most-recent/most-used
vehicle" rule into `resolveVehicleView` itself, so every tab (and the
sidebar switcher) agrees on one fallback, and drop Overview's local
`vehicleId` state plus its duplicate header `<select>` in favor of the
sidebar switcher it already has.

### 4.3 Query-hook shape is inconsistent between features
`features/lab/queries.ts`, `features/diagnose/queries.ts`,
`features/history/queries.ts` use TanStack Query end-to-end. `views/lab/plan.ts`
mixes in a raw `invoke()` call inside a `useQuery` (fine — it's still one
cache), but `views/lab/ModuleFaults.tsx`, `views/lab/DidReader.tsx`, and
`views/lab/RangeScanner.tsx` bypass the query layer entirely for their reads
(local `useState` + direct `DeviceService` calls), even though their sibling
cards in the same file (`AutoDiscovery`, `ParkedVerification`) use the query
hooks. No functional bug here, just no single rule for "when does a Lab card
get a query hook vs. local state."

## 5. Notes carried over from the redesign work

This map is the "before" picture for `docs/product/ui-flow-spec.md` (stages
A/B/C, screens A1–C4). The Lab button-sprawl (§3.1) is exactly what that
spec's B1/B2/B3 consolidation is meant to fix; the Diagnose/Lab fault-code
split (§3.2) and the three vehicle-picker implementations (§4.2) aren't yet
addressed by that spec and are worth folding into the same pass.
