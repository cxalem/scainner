# Decision log: planner, 3d-logos

Each block: what, options considered, why, risk.

## New module src/components/emblems.tsx

What: move all emblem code (constants, Citroen, Nameplate, new brands,
registry) into a new file; VehicleScene keeps only BrandEmblemModel and
imports the registry.
Options: (a) keep growing VehicleScene.tsx, (b) new emblems.tsx module,
(c) one file per brand under src/components/emblems/.
Why: (b). VehicleScene.tsx is already ~1350 lines and this increment adds
four components with more to come; a single emblems module keeps the
builder's boundary clean and reviewable without the overhead of (c),
which can come later if the file itself gets large. The registry
(`EMBLEMS[key] ?? NameplateEmblem`) also removes the per-brand ternary,
so future brands touch only emblems.tsx.
Risk: the extraction step could subtly change Citroen rendering; mitigated
by moving code verbatim and screenshot-verifying the demo flow in step 1
before any new geometry exists.

## Brand set: Renault, Mercedes, Volvo, Opel (not Mitsubishi)

What: four brands from the research's cheap geometric tier; dropped
Mitsubishi from the research's five-brand suggestion.
Options: (a) all five per research, (b) four, dropping Mitsubishi,
(c) fewer (Renault only) or more (add Toyota/Audi).
Why: (b). Mitsubishi has no WMI entry in brand.ts, and the non-goals
forbid WMI expansion this increment, so its emblem would be unreachable
dead code; it is also niche in Spain per the research ranking. The four
kept brands all have existing WMI rows and rank tier A or B for Spain.
Toyota/Audi are excluded because they are the moderate-effort tier
(curves, torus) and this increment proves the cheap tier first.
Risk: none material; Mitsubishi geometry (3 diamonds) is trivial to add
later together with its WMI row once verification work happens.

## brand.ts out of scope

What: no edits to src/lib/brand.ts at all.
Options: (a) fix flagged WMI errors, (b) leave untouched.
Why: (b). The research flagged no concrete corrections; it judged the
existing table "reasonably consistent" and deferred full registry
re-verification as follow-up work. With nothing concrete to fix,
touching the table would be scope sprawl and risks the worse failure
mode the research named (wrong emblem beats no emblem).
Risk: an existing prefix could be wrong; unchanged from today, and the
follow-up verification stream owns it.

## Mock VIN technique: DEV-gated query param, kept permanently

What: `?vin=` URL param override in VehicleScene, active only when
`import.meta.env.DEV`, passed into BrandEmblemModel.
Options: (a) temporarily hardcode a VIN and revert before PR, (b)
DEV-gated query param that stays in the code.
Why: (b). It makes every brand screenshot reproducible from a URL (the PR
test instructions become copy-paste links), needs no revert commit, and
future emblem increments and reviewers reuse it. (a) invites a forgotten
revert and makes reviewer re-verification awkward. DEV gating keeps
production behavior byte-identical.
Risk: tiny permanent code addition inside the boundary; the DEV gate and
step 1 screenshot (nameplate via ?vin=WF0...) verify it cannot leak.

## Sequencing: extraction before the Renault risk gate

What: step 1 is the mechanical module extraction plus dev override; the
riskiest step (proving Renault reads at card size) is step 2.
Options: (a) prototype Renault first inside VehicleScene, extract later,
(b) extract first, then Renault.
Why: (b). The Renault step cannot be verified at all without the ?vin=
override, which lands with the extraction; and extracting first means
the risky work happens directly in its final home, avoiding a second
churn commit. Step 1 is near-zero-risk (verbatim moves) and is itself
independently verified before step 2 starts. The risk-first spirit
holds: no polish or mass production happens before Renault is proven,
and step 2 carries an explicit STOP fallback.
Risk: if extraction somehow breaks Citroen, it is caught by step 1's own
screenshot before any new work stacks on top.

## Geometry specs written as dimensions, not code

What: each brand spec gives shapes, sizes, and angles (e.g. Mercedes ring
outer radius 0.55, band 0.07, spokes at 90/210/330) instead of code.
Options: (a) write the Shape code in the plan, (b) dimensioned prose.
Why: (b). The builder is Sonnet-class and the Citroen component is a
complete worked example of the extrude/bevel/dispose pattern; dimensions
plus the shared-constraints block remove the ambiguity that matters
(scale, band thickness, placement) while leaving point-by-point outline
authoring, which needs live visual iteration anyway, to the builder.
Risk: stated dimensions may need tuning against the real card; the plan
explicitly allows iteration within each step's verification loop.
