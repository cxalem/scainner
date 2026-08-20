# Codex cross-review: monorepo

Reviewer: Codex, 2026-08-21. Scope: `main...HEAD` in
`/Users/cxalem/projects/scainner-monorepo`, four commits:

```
473c0ea review(monorepo): fix post-move staleness found in stage-4 review
d4cdc90 build(monorepo): scaffold apps/mobile as an empty Expo app shell
0fd0f2e build(monorepo): extract packages/core from apps/desktop's Effect layer
a38aa6f build(monorepo): scaffold pnpm+turbo monorepo, move Tauri app to apps/desktop
```

## Verdict: OBJECTIONS-NONBLOCKING

I do not see a correctness defect in the monorepo wiring, the core extraction
boundary, or the type/build pipeline that should block this scaffolding stream.
The first reviewer's substantive claims mostly reproduce under independent
checks. The one caveat from my pass is packaging-specific: `pnpm tauri build`
successfully compiled the release binary and produced
`apps/desktop/src-tauri/target/release/bundle/macos/Scainner.app`, but DMG
creation failed in this environment at `hdiutil: create failed - Device not
configured`. That does not look like a monorepo path regression: verbose Tauri
output found the project under `apps/desktop/src-tauri`, ran the local desktop
`pnpm build`, compiled the moved Rust crate, and bundled the `.app` before
failing in macOS disk-image creation. It does mean I cannot honestly say my
pass produced the final `.dmg` installer artifact.

## Findings

1. Nonblocking: DMG packaging was not reproduced in my environment.

   Evidence: `pnpm tauri build --bundles dmg --verbose` from `apps/desktop`
   ran the moved project correctly and then failed at:

   ```
   hdiutil: create failed - Device not configured
   ```

   The release binary and `.app` bundle exist and are real:
   `apps/desktop/src-tauri/target/release/scainner` and
   `apps/desktop/src-tauri/target/release/bundle/macos/Scainner.app/Contents/MacOS/scainner`
   (`Mach-O 64-bit executable arm64`). I am not treating this as a blocker
   because the failure is in `hdiutil` disk-image creation after the moved app
   has already built and bundled, and the same Tauri config is a byte-identical
   rename from `main`. Before public installer distribution, run the release
   job on the intended macOS host and verify the `.dmg`, signing, and
   notarization path end to end.

2. Nonblocking: `packages/core` is still unproven through a second runtime
   consumer.

   The extraction is clean by inspection and by direct grep, but `apps/mobile`
   does not import `@scainner/core` yet. That is acceptable for this stream
   because the stream is monorepo scaffolding plus a boundary extraction, not a
   claim that the mobile transport has validated the boundary. The first mobile
   stream that imports `@scainner/core` should make Metro/Expo bundling of that
   workspace TypeScript package an explicit first verification step.

3. No blocking workspace/API/pipeline defect found.

   Root `package.json`, `pnpm-workspace.yaml`, and `turbo.json` are coherent
   for this shape: root scripts delegate to Turbo, workspaces include
   `apps/*` and `packages/*`, desktop depends on `@scainner/core` via
   `workspace:*`, and forced Turbo build executed the desktop Vite build and
   mobile `expo export` with no cached tasks. `packages/core` has no build
   script, which is consistent with the current source-only package surface.

## Required claim checks

- The pre-existing split comment is real. On `main`,
  `src/core/services/device-service.ts` says: swapping `DeviceServiceLive`
  for a future transport such as a mobile BLE bridge changes one file, not
  every call site. The current split implements that design: the Tag/interface
  moved to `packages/core`; the Tauri `invoke` live layer lives in
  `apps/desktop/src/core/services/device-service-live.ts`.

- `packages/core` is grep-clean for Tauri-specific imports and app aliases.
  `grep -RInE 'tauri|@tauri-apps|window\.|@/|apps/desktop|src-tauri|invoke\('`
  over `packages/core/src`, `packages/core/package.json`, and
  `packages/core/tsconfig.json` found only one prose comment mentioning raw
  `invoke()` rejection history in `errors.ts`; no import or runtime dependency
  on Tauri exists. Import grep shows only `effect` plus relative internal
  imports. `packages/core/package.json` depends only on `effect`.

- `tauri.conf.json` did not need content changes. `cmp` between
  `git show main:src-tauri/tauri.conf.json` and
  `apps/desktop/src-tauri/tauri.conf.json` returned equal, and
  `git diff -M --summary main...HEAD` reports a 100% rename. Its
  `frontendDist: "../dist"` remains correct because `src-tauri` and the Vite
  frontend moved together under the same parent.

- The `.gitignore` fix was a real bug and now works. `main` had
  `public/models-preview/`, which would match `public/models-preview/probe.stl`
  but not `apps/desktop/public/models-preview/probe.stl` after the move.
  Current `git check-ignore -v --no-index
  apps/desktop/public/models-preview/probe.stl` reports:
  `.gitignore:40:apps/desktop/public/models-preview/`.

- The mobile scaffold is intentionally empty. `apps/mobile` is Expo starter
  code plus stock assets and no `@scainner/core`, OBD2, Bluetooth, or transport
  code.

## Verification

Commands run independently:

```
npx tsc --noEmit        # packages/core: pass
npx tsc --noEmit        # apps/desktop: pass
npx tsc --noEmit        # apps/mobile: pass
cargo check             # apps/desktop/src-tauri: pass
pnpm turbo run build --force  # root: pass, 0 cached, desktop build + mobile expo export
pnpm tauri build        # apps/desktop: release binary + .app produced, DMG failed in hdiutil
pnpm tauri build --bundles dmg --verbose  # same hdiutil failure, clearer stderr
```

The forced Turbo build emitted two `WARNING IO error: Operation not permitted
(os error 1)` lines after successful package builds, but exited 0 with both
tasks successful. I did not find a build correctness impact from that warning.

## Answers to open questions

1. Is extracting `packages/core` now premature?

   No, not for this stream's stated scope. The boundary is correct by
   inspection: the shared package contains Effect schemas, errors, the
   `AiService` implementation, and the `DeviceService` Tag/interface; the
   Tauri live transport remains in the desktop app. It would be premature only
   if this stream claimed the extraction was already validated by mobile. It
   is not. The next mobile integration must prove Metro consumption and actual
   transport implementation.

2. Does unresolved MX+/ExternalAccessory research block this scaffolding
   stream?

   No. I checked history: `docs/workflows/monorepo/mx-transport-research.md`
   exists in commit `580a527` but not in this working tree. That research keeps
   the native-module/New-Architecture and OBDLink protocol-string questions
   open. Those questions do not block this branch because `apps/mobile` has no
   Bluetooth code and the monorepo/core split works regardless of whether the
   eventual transport is `react-native-bluetooth-classic`, a custom Expo module,
   Android-first, or something else.

3. Any missed correctness defect in workspace wiring, core API surface, or
   build/lint/typecheck pipeline?

   I found none that blocks merge. The caveat is process-level: `packages/core`
   exposes raw `.ts` through `main` and `types`, which Vite and `tsc` handle
   today. Expo/Metro handling remains unproven until mobile imports it.

4. Any Tauri build/packaging risk from the monorepo move?

   Current app build paths are sound: Tauri finds `apps/desktop/src-tauri`,
   runs `apps/desktop`'s local `pnpm build`, resolves `../dist`, compiles the
   crate, and produces a `.app`. There is no `.github` release workflow in this
   worktree to audit, and I found only backlog/documentation references to
   future installer work. The risk is future release automation: any future
   `release.yml`, signing, notarization, or artifact upload script must set
   working directories and artifact paths to `apps/desktop` and
   `apps/desktop/src-tauri/target/...`. That should be a checklist item when
   installer/release work is built, not a blocker for this scaffolding branch.

## Gut check

I would trust building and running the desktop app from this structure today.
I would trust the `.app` bundle path from this structure today. I would not
claim the full distributable DMG path is proven by my pass, because `hdiutil`
failed here; I would require one clean release-host DMG/signing/notarization
run before distributing installers to users.
