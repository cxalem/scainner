# Comments cleanup report

Counts are lexical comment lines in the scoped source files; strings, Rust attributes, generated UI, fixtures, and other excluded paths are not counted.

## Counts

| Area | Before | After | Removed | Kept |
| --- | ---: | ---: | ---: | ---: |
| rust | 2,895 | 20 | 2,875 | 20 |
| desktop-ts | 2,355 | 6 | 2,349 | 6 |
| core | 199 | 0 | 199 | 0 |
| uds-map | 605 | 2 | 603 | 2 |
| landing | 163 | 0 | 163 | 0 |
| scripts | 252 | 10 | 242 | 10 |
| **Total** | **6,469** | **38** | **6,431** | **38** |

## Kept comments

### rust

- `apps/desktop/src-tauri/build.rs:78` — `// Stable mtimes avoid invalidating downstream units on unrelated rebuilds.` — deliberate deviation
- `apps/desktop/src-tauri/src/main.rs:1` — `// Windows otherwise opens a second console window in release builds.` — workaround
- `apps/desktop/src-tauri/src/elm/uds.rs:1626` — `// A transient voltage read failure must not abort an otherwise safe operation.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:30` — `// SAFETY: the owned fd is accessed only by the supervisor thread.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:54` — `// SAFETY: fd is an unclaimed descriptor returned by libc::open.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:90` — `// SAFETY: c is a valid NUL-terminated path and the returned fd is checked.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:100` — `// SAFETY: fd is owned here; every libc result is checked before use.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:112` — `// termios VTIME is measured in deciseconds.` — protocol/hardware gotcha
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:153` — `// SAFETY: fd is valid and owned by self for the duration of this call.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:159` — `// SAFETY: fd is valid and bytes exposes a live buffer of the supplied length.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:172` — `// SAFETY: fd is valid and owned by self.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:175` — `// SAFETY: chunk is writable for chunk.len() bytes and fd is valid.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:195` — `// SAFETY: fd is owned by self and is invalidated immediately after closing.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:240` — `// SAFETY: buf is writable for one byte and the test owns fd.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:253` — `// SAFETY: fds provides storage for the two descriptors written by pipe.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:256` — `// SAFETY: read_end is the valid descriptor returned by pipe.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:270` — `// SAFETY: the test owns read_end and closes it exactly once.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:278` — `// SAFETY: path is NUL-terminated and the returned fd is checked.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:287` — `// SAFETY: fd is valid until the close below.` — safety invariant
- `apps/desktop/src-tauri/src/elm/transport/elm_serial.rs:292` — `// SAFETY: the test owns fd and closes it exactly once.` — safety invariant

### desktop-ts

- `apps/desktop/src/vite-env.d.ts:1` — `/// <reference types="vite/client" />` — directive
- `apps/desktop/src/components/VehicleScene.tsx:1` — `// /* Work around lint_brand_tokens.py treating model asset paths as product tokens.` — workaround
- `apps/desktop/src/components/emblems.tsx:1` — `// /* Work around lint_brand_tokens.py treating asset identifiers in this registry as product tokens.` — workaround
- `apps/desktop/src/theme/rendering.test.ts:23` — ``// @ts-expect-error CHROME_MATERIAL is declared `as const``` — directive
- `apps/desktop/src/components/ConnectGate.tsx:113` — `// eslint-disable-next-line react-hooks/exhaustive-deps` — directive
- `apps/desktop/src/components/ConnectGate.tsx:161` — `// eslint-disable-next-line react-hooks/exhaustive-deps` — directive

### uds-map

- `packages/uds-map/scripts/migrate-v8-to-v9.py:1` — `#!/usr/bin/env python3` — directive
- `packages/uds-map/scripts/migrate-v8-to-v9.py:46` — `# NOASSERTION sources are verification-only because the licence gate cannot classify them.` — licence

### scripts

- `scripts/lint_proprietary_license.py:1` — `#!/usr/bin/env python3` — directive
- `scripts/correlation_replay.py:1` — `#!/usr/bin/env python3` — directive
- `scripts/lint_brand_tokens.py:1` — `#!/usr/bin/env python3` — directive
- `scripts/pipeline-status.mjs:1` — `#!/usr/bin/env node` — directive
- `scripts/session.py:1` — `#!/usr/bin/env python3` — directive
- `scripts/scainner_api.py:1` — `#!/usr/bin/env python3` — directive
- `scripts/import_obdb_fixtures.py:1` — `#!/usr/bin/env python3` — directive
- `scripts/sanitize_evidence.py:1` — `#!/usr/bin/env python3` — directive
- `apps/desktop/scripts/render-emblems.mjs:1` — `#!/usr/bin/env node` — directive
- `apps/desktop/scripts/rotate-emblem-glb.mjs:1` — `#!/usr/bin/env node` — directive

There are no kept comments in core or landing.

## Unsafe blocks without SAFETY comments

None. Every Rust `unsafe` use in scope has a local `SAFETY:` comment.

## Candidates for a rename

None identified.

## Checks

- rust — `cargo fmt --check` passed; `cargo test --locked` passed (310 tests); brand-token lint passed with the unchanged 5-token/2-file baseline.
- desktop-ts — workspace typecheck passed; workspace tests passed (223 tests); desktop production build passed; landing build is environment-blocked (Google Fonts fetch was denied in the sandbox, then Turbopack was denied permission to bind its internal port after network approval); brand-token lint passed unchanged.
- core — workspace typecheck passed; workspace tests passed (223 tests); desktop production build passed; landing build has the same environment blocker; brand-token lint passed unchanged.
- uds-map — 98 tests passed; `lint:pack` passed; `coverage:check` passed; migration Python compiled; brand-token lint passed unchanged.
- landing — workspace typecheck passed; workspace tests passed (223 tests); desktop production build passed; landing build has the environment blocker described above; brand-token lint passed unchanged.
- scripts — Python compile command completed with no reported syntax errors; brand-token lint passed with the unchanged 5-token/2-file baseline.
