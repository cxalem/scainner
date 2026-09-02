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
repo; it is a review aid, not an asset. Per-badge overrides live in
`scripts/emblem-render-overrides.json` — camera angle, framing margin, the
heuristic's thresholds, and `rotateDeg`, which exists because some of these
files are exported face-down and would otherwise render mirrored or upside
down. Nothing in the geometry says which way is up for a logo, so orientation
is a judgement call recorded per file. Note that `rotateDeg` corrects the PNG
only: a badge that needs it still renders wrong on the app's live canvas.

Some GLBs model the badge as the mark plus the maker's name in separate letter
meshes. The renderer strips that bottom row so the PNG is a mark rather than a
lockup, and logs how many meshes it dropped per file; a badge that is *only* a
wordmark is left whole.

## Known issues

**byd** — the glyphs are individually mirrored (the B draws as "Ǝ", the D as
"ꓷ") while the letter order stays correct, so it renders backwards in the app
and in the PNG alike. No rotation fixes it: all four 180° combinations were
tried, and a rigid rotation cannot mirror glyphs without also reversing their
order. The defect is in the source art, which needs re-drawing; both available
versions of this file share it.

**suzuki** — removed rather than shipped. Its source geometry is torn: sawtooth
edges and a bowed face, unrecognizable as the real mark. Re-source it from a
clean batch.

Badges exported face-down used to be a third entry here. They are fixed at the
file now, by `scripts/rotate-emblem-glb.mjs`, which bakes a rotation into the
vertices so the app's live canvas and the PNGs agree.
