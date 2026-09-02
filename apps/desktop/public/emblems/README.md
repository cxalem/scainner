# Emblems

3D vehicle badges. Provenance and the model-by-model decisions behind them are
in `docs/workflows/3d-logos/` — start with `decisions-build.md`.

## `glb/` — the source of truth

One GLB per make, keyed the same way `src/lib/brand.ts` keys a make, loaded at
runtime by `GlbEmblem` in `src/components/emblems.tsx`. These are the real
asset: everything else here is derived from them and can be thrown away and
regenerated.

## `png/` — flat renders, derived

A square, transparent, near-frontal render of each GLB, 1024 px, produced by
`scripts/render-emblems.mjs`. They exist for the places a live WebGL canvas is
the wrong tool — a static list row, a document, an export — with the same
chrome material, studio environment and tone mapping as the app's own canvas,
so a PNG next to a rendered badge reads as the same object.

Nothing in the app imports them yet. Do not hand-edit them, and do not treat a
PNG as the asset of record: change the GLB, then re-render.

### Regenerating

```sh
pnpm --filter @scainner/desktop render:emblems -- --all
```

Needs Google Chrome on the machine (it does the WebGL rendering headlessly;
set `CHROME_BIN` if it is somewhere unusual) and an installed `node_modules`
somewhere in the workspace for three.js (`THREE_DIR` overrides that).

Useful flags — `--all`, or one or more GLB paths; `--out <dir>`; `--size <px>`;
`--keep-text` to keep the wordmark meshes the script otherwise strips;
`--contact-sheet <path>` to write a labelled grid of everything it rendered,
which is the fastest way to check a batch. Write the contact sheet outside the
repo; it is a review aid, not an asset. Per-badge camera and heuristic
overrides live in `scripts/emblem-render-overrides.json`.

Some GLBs model the badge as the mark plus the maker's name in separate letter
meshes. The renderer strips that bottom row so the PNG is a mark rather than a
lockup, and logs how many meshes it dropped per file; a badge that is *only* a
wordmark is left whole.
