# Research: Windows release artifact

Date: 2026-08-31. Base: `origin/main@c612e1b`. Existing unpushed build reviewed:
`ws/windows-ci-build@473a5b5` (base `c0cee6e`).

## Scope

SCAINNER-03 is a release-pipeline task, not the Windows serial port. Its useful
outcome is an internal draft installer that José can open on Windows before any
scanner exists. It must not imply USB, Bluetooth or vehicle diagnostics work.

## Verified repository facts

- Current `release.yml` builds one universal macOS draft on `v*` tags or manual
  dispatch. The branch commit adds a serialized Windows x86_64 MSVC job and shared
  release notes; it changes no Rust, frontend or bundle configuration.
- The branch is seven commits behind current `origin/main`. Triggering it would build
  an outdated application snapshot even though the workflow file has no merge conflict.
- PR CI runs on Ubuntu only. A Windows compiler/bundler failure is first discovered
  after a tag or manual release trigger.
- `tauri.conf.json`, Cargo and desktop package metadata all say `0.1.0`; the workflow
  accepts any `v*` tag and does not compare tag to embedded version.
- Manual dispatch has no tag input but passes `github.ref_name` as `tagName`. Dispatch
  from `main` can therefore create or address a release named `main`.
- Both release jobs use mutable action tags, including `tauri-apps/tauri-action@v0`,
  while holding release-write permission and receiving the updater private key.
- The Windows installer has no Authenticode certificate. Updater signatures prove an
  update came from Scainner's updater key; they do not remove Windows SmartScreen.
- Backlogs still call Windows release output deferred. The branch intentionally left
  them stale, so task routing and repository truth disagree.

## Independent assessment of Claude's build

The narrow x86_64 Windows job and honest Wi-Fi-only release note are directionally
correct. The commit should not be handed to Alejandro as ready to merge. Its release
integrity depends on unproved updater-manifest behavior, exposes signing secrets to
mutable actions, permits an invalid manual release identity, lacks tag/version checks,
and has never compiled on Windows.

The assertion that two serialized action runs safely merge one `latest.json` is not
local evidence. Tauri's action is designed for multi-platform releases, but its
updater JSON behavior has changed across releases and parallel upload races have been
reported. The first real draft must inspect every platform entry and signature.

## Viable release designs

### A. Serialized native builds into one draft release

Use one reviewed, SHA-pinned Tauri action release. Build macOS universal and Windows
x86_64 sequentially into the same draft, then verify release assets and `latest.json`.

Advantages: closest to the existing one-file workflow and Tauri's supported path;
smallest correction. Tradeoffs: the action still owns manifest mutation, so the first
draft is a hard evidence gate and future action upgrades require renewed review.

### B. Build artifacts first, finalize once

Native jobs build signed updater bundles but upload workflow artifacts only. A final
job downloads them, creates one draft release and produces/uploads one updater
manifest from all outputs.

Advantages: one release writer and deterministic manifest ownership. Tradeoffs: more
workflow/script surface, explicit manifest generation and greater maintenance burden.

**Recommendation:** A for the internal Windows-launch milestone, with immutable action
SHAs, tag/version validation, sequential execution and a post-build manifest gate. If
the first draft does not retain all macOS and Windows updater entries, stop and re-plan
B rather than layering retries over unknown behavior.

## Security and distribution boundary

- Pin every third-party action to a reviewed full commit SHA. GitHub documents full
  SHA pinning as the immutable action policy.
- Keep workflow default `contents: read`; grant write only to the two native release
  jobs and pass signing secrets only to their Tauri steps. Checkout retains no credentials.
- Draft artifacts are internal test output. Record their SHA-256. Do not publish an
  unsigned installer or normalize SmartScreen bypass instructions for customers.
- Public Windows distribution needs a separate Authenticode decision and a real
  installer/reputation test; updater signing alone is not code signing.

## Evidence available without scanner hardware

A Windows runner can prove compilation, installer creation and updater assets. An
authorized Windows machine can prove installation, WebView2 launch, SQLite startup,
the disconnected UI and clean uninstall. A mock TCP ELM fixture could exercise the
Wi-Fi transport without a physical scanner, but no such release fixture exists today.

No scanner-free result proves USB COM, Bluetooth SPP, ELM timing, ECU communication,
recording from a car, DTC operations or UDS. Those remain SCAINNER-01/Phase 3 claims.

## Sources checked 2026-08-31

- [Tauri GitHub pipeline guide](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri action inputs and release behavior](https://github.com/tauri-apps/tauri-action)
- [Tauri action releases](https://github.com/tauri-apps/tauri-action/releases)
- [GitHub full-SHA action policy](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
