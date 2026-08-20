# Engineering patterns (all agents)

Hard-won rules from this repo's history. Violating one of these has
already cost real debugging time at least once.

1. Verify visually, then claim. UI work is verified with screenshots of
   the running app, at more than one state. The connect flow for the
   browser demo: open localhost:1420, click Connect, wait about 15s, the
   discovery overlay appears, scroll down, click "Go to dashboard".
2. Typecheck constantly: `npx tsc --noEmit` after each meaningful change.
   Rust: `cargo check` in src-tauri when touched.
3. Mock parity: every Tauri command used by the frontend needs a matching
   case in src/lib/mock.ts, or the browser demo breaks silently.
4. Same-name asset files are cached by the browser. When replacing a file
   in public/ keep the name only if you hard-reload during verification,
   otherwise use a new name. A stale cached asset once burned a whole
   debugging night.
5. No layout shifts. New UI states overlay (modal, fixed cover) or swap in
   place. Never insert banners that push content down.
6. Plain language in UI copy and docs: clear plain English, no em dashes,
   no decorative formatting. Spanish will follow via the i18n stream.
7. Isolation discipline: builders work in an explicit worktree on a
   ws/<stream> branch. Automatic agent isolation follows the wrong repo
   in this setup; do not rely on it.
8. Decision logs are part of the deliverable. An unlogged surprising
   choice found in the diff counts as a defect.
9. localStorage is for machine-local secrets and UI state (API key, last
   reports). SQLite is for car data. Never put secrets in SQLite: the DB
   gets exported wholesale into AI briefings.
10. The app is single-theme light by design. Do not add dark-mode
    variants.
