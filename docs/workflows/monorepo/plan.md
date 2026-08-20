# Plan: Turborepo monorepo + mobile app start

Written directly (not through the researcher/planner agent split — Alejandro
wants this ready fast, mobile work starts tomorrow). Gated on the Effect
migration landing and getting reviewed first, per his own explicit call:
starting two architecture-touching streams at once already caused a real
three-way merge conflict this session (write-caps + app-perf both touching
Diagnose.tsx) — not repeating that with Effect + monorepo overlapping.

## The real first task, before any scaffolding: resolve the MX+ transport question

This is not a config detail, it decides which tooling is even usable.
Checked directly, not assumed: the OBDLink MX+ (hardware already ordered,
`_MOC.md`) is MFi-certified **Bluetooth Classic SPP on iOS**, not BLE — it
routes through Apple's ExternalAccessory framework specifically because
Apple restricts direct Bluetooth Classic access to MFi-certified
accessories. The two standard React Native BLE libraries
(`react-native-ble-plx`, `react-native-ble-manager`) only speak BLE — they
cannot see or connect to an MFi Classic-SPP device at all.

The current dev dongle (vGate iCar Pro) is dual-mode (both Classic SPP and
BLE), which is exactly the trap: BLE-based dev work would appear to work
against the vGate today and then silently fail against the actual target
hardware (MX+) on iOS. Android's story is different again — Android's
Bluetooth Classic SPP access isn't gated by anything like MFi, but React
Native's classic-SPP library ecosystem is thinner and less battle-tested
than the BLE ecosystem the search above surfaced.

**Before writing any mobile app code**: confirm (a) whether Expo's managed
workflow can reach ExternalAccessory at all (it cannot, natively — this
needs either a custom native module via Expo's config plugin system, or
bare/prebuild workflow with actual Swift written against
`ExternalAccessory.framework`), and (b) the Android-side classic-SPP
library choice. This is real native-code surface, not an npm install. If
this can't be resolved in one sitting, the honest move is to scope the
first mobile milestone around this validation (connect to the dongle at
all, over either protocol, on one platform) rather than a full-app-shaped
first milestone.

## Monorepo shape

Grounded in current (2026) real practice, not guessed: pnpm workspaces +
Turborepo + Expo (SDK 55+, which shipped first-class monorepo/Metro
support) is the standard stack for exactly this combination. Scainner
already uses pnpm — no tooling mismatch to resolve there. Tauri has less
direct monorepo prior art than Expo/Next combinations, but its frontend is
plain Vite + React, so it fits the same pnpm-workspace + Turborepo shape
any Vite app would.

```
scainner/                    # becomes the monorepo root
  apps/
    desktop/                 # today's Tauri app, moved here largely as-is
    mobile/                  # new, Expo — starts empty, grows from the
                              # MX+ transport validation above
  packages/
    core/                    # the Effect-based DeviceService/AiService/
                              # Schema layer, once the Effect stream lands —
                              # this is the whole point of that stream's
                              # feature-based restructure: this package is
                              # a lift, not a rewrite, when this plan runs
    data/                    # the car reference dataset — see
                              # ../car-data/plan.md, shared by both apps
    ui/                      # NOT assumed cross-platform-shareable —
                              # Tauri/web and React Native have different
                              # component primitives. Scope this to
                              # genuinely shareable things (design tokens,
                              # color palette, maybe icon set), not
                              # components, until proven otherwise
  turbo.json
  pnpm-workspace.yaml
```

**Migration order**: (1) scaffold the monorepo root + move the existing
Tauri app into `apps/desktop` with zero behavior change, verified with a
full build before touching anything else — this step alone is real risk
(path aliases, Tauri's own config expecting specific relative paths,
CI/build scripts) and deserves its own clean commit and verification pass,
not bundled with anything new. (2) Extract `packages/core` from the
already-landed Effect `src/core/` — should be close to a direct move given
that's exactly what the Effect stream's phase 4 restructure was for. (3)
Scaffold `apps/mobile` as a fresh Expo app, empty except for the MX+
transport validation spike. (4) `packages/data` once ../car-data/plan.md's
work exists to move in.

## What this plan does NOT scope

- The actual mobile app's features (connect flow, discovery animation,
  driver-facing UI) — that's product-plan.md's Milestone 2, a separate
  planning pass once the transport question has a real answer.
- Any change to how the desktop app builds or ships in the short term —
  `apps/desktop` should build identically to today immediately after the
  move, that's the acceptance bar for step 1, not an opportunity to also
  change its build pipeline.
- CI/CD changes for a two-app repo (build matrix, per-app release
  pipelines) — real follow-up once both apps exist, not before.

## Sequencing

Gated on: Effect migration landing (`ws/effect-architecture`) and clearing
review, so `packages/core`'s extraction (step 2 above) is lifting settled,
reviewed code rather than a moving target. The MX+ transport
investigation (the section above) has no such dependency — it's pure
research/spike work against the existing Tauri app or a throwaway test
project, and could start today if wanted, independent of both this plan's
scaffolding and the Effect stream. Worth flagging: given the mobile work
is meant to start tomorrow and this plan is otherwise gated on Effect,
the transport spike is the one piece that can genuinely run in parallel
without waiting.
