# Research: scalable 3D brand emblem library

## 1. Brand coverage

Fact (repo): `src/lib/brand.ts` covers 34 WMI prefixes across 24 brand keys (citroen, ds, peugeot, opel, fiat, alfa-romeo, renault, dacia, volkswagen, audi, seat, skoda, bmw, mercedes, porsche, toyota, honda, nissan, mazda, hyundai, kia, suzuki, ford, volvo, tesla, land-rover, jaguar). Only `citroen` has real geometry; every other key falls back to `NameplateEmblem`.

Fact (web, partial paywall): Spain full-year 2025 new-car market ([bestsellingcarsblog.com](https://bestsellingcarsblog.com/2026/01/spain-full-year-2025-dacia-sandero-and-renault-clio-in-the-lead-in-strongest-market-in-6-years/)): Toyota #1 at 8.4% share, then Renault, Volkswagen, Hyundai, Seat, Dacia in the top 6. MG, BYD, Omoda, Jaecoo, Ebro are named as fast-growing newcomers. The full top-20 table was paywalled.

Assessment, rough likelihood ranking for a Spain-first tester pool (blends the confirmed top 6 with general market knowledge, since used cars on the road skew a bit older and more French/Spanish than this year's new sales):
- Tier A, near certain: Toyota, Renault, Volkswagen, Seat, Peugeot, Citroen, Opel, Dacia, Ford, Hyundai, Kia
- Tier B, common: BMW, Mercedes-Benz, Audi, Skoda, Nissan, Fiat, Mazda, Volvo
- Tier C, present, lower volume: Honda, Suzuki, Mini, Land Rover, Jaguar, Alfa Romeo, Porsche
- Tier D, rising fast, low installed base today: MG, BYD, Tesla, Omoda, Jaecoo, Ebro. Worth a WMI entry, low priority for hand-authored geometry.

Gap check against `brand.ts`: Mini, MG, BYD, Omoda, Jaecoo, Ebro are missing (recent-entry brands, expected per the file's own comment). Mitsubishi, Lancia, Chevrolet, SsangYong, Subaru are also absent, niche in Spain today but plausible long-tail entries. Not a defect, just backlog.

## 2. Mark complexity tiers (top ~20)

| Brand | Mark | Tier | Recommendation |
|---|---|---|---|
| Citroen | double chevron | (a) geometric | done |
| Renault | diamond outline | (a) geometric | real geometry, trivial extrude |
| Mitsubishi | 3 diamonds | (a) geometric | real geometry |
| Mercedes-Benz | 3-point star in ring | (a) geometric | real geometry, high payoff |
| Volvo | circle, arrow, bar | (a) geometric | real geometry |
| Opel | lightning bolt in ring | (a)/(b) | real geometry |
| Toyota | 3 overlapping ellipses | (a)/(b), pure curves, no letters | real geometry, moderate effort |
| Audi | 4 interlocking rings | (a) geometric | real geometry via torus geometry, not extrude |
| BMW | quartered roundel + wordmark ring | (b), tiny wordmark likely unreadable small | geometry, drop the wordmark text |
| Volkswagen | circle with V over W | (b), letters as holes | real geometry once holes are supported |
| Hyundai | slanted H in oval | (b) moderate | optional, single letterform |
| Seat | stylized S badge | (b) moderate | optional |
| Peugeot | standing lion, detailed mane | (c) figurative | nameplate |
| Ford | cursive oval wordmark | (b), script hard to extrude small | nameplate |
| Kia | signature-style wordmark | (b), hard to extrude cleanly | nameplate |
| Skoda | winged arrow in circle | (b), fiddly wing shape | nameplate |
| Nissan | wordmark bar in circle | (b), mostly a wordmark | nameplate |
| Fiat | wordmark in oval | (b), wordmark | nameplate |
| Mazda | stylized wings in oval | (b)/(c) | nameplate |
| Dacia | wordmark only, no pictorial mark | (b) wordmark | nameplate is correct, not a compromise |

Assessment, recommended real-geometry priority: Renault, Mercedes-Benz, Volvo, Opel, Mitsubishi first (cheap tier-a wins), then Toyota and Audi (moderate effort, high recognition payoff), then BMW and VW (need hole support). Peugeot, Ford, Kia, Skoda, Nissan, Fiat, Mazda stay on the nameplate fallback; that is the correct answer for those marks, not a stopgap.

## 3. Technique comparison

Hand-authored `THREE.Shape` (current Citroen approach). Facts from code: `chevronShape` builds a closed polygon with `moveTo`/`lineTo`, `ExtrudeGeometry` takes an array of shapes plus bevel options, `.center()` recenters on the origin. Zero new dependencies, full control of vertex count and bevel. Cost: curved marks (Toyota, BMW) need hand-written bezier curves via `.bezierCurveTo`, tedious but still supported directly.

SVG source plus `SVGLoader` and `ExtrudeGeometry`. Facts (web, three.js docs and GitHub): `SVGLoader.createShapes(path)` is the documented way to turn a loaded `ShapePath` into `THREE.Shape[]`, preferred over the older `path.toShapes()` because it reads `fillRule` from `ShapePath.userData.style` correctly and fixes hole-detection bugs that affected `toShapes()` (mrdoob/three.js issues #20858, #13653, PR #24114). Concretely: letter cutouts (VW's V/W, BMW's wordmark, Hyundai's H) come through as holes automatically from SVG subpaths with the right winding rule, versus hand-building inner-loop hole shapes point by point. Cost: needs an SVG source per brand (section 4), and wires up `SVGLoader` (ships with three, not a new package). Runtime cost stays parse-once via `useMemo`, same pattern as today.

Pre-built glTF assets per brand. Not recommended as the primary path. The "C4 model saga" in `docs/workflows/patterns/3d.md` shows a bespoke glTF model was expensive to get right (normals, materials, segmentation). A glTF per emblem reintroduces that pipeline for flat vector marks that do not need it.

Contributor workflow: hand-Shape is a self-contained diff in the .tsx file, easy to review, but fights back on curves. SVG plus SVGLoader lets a contributor draw a mark in any vector tool and drop one file in, friendlier to a non-coder but harder to review by eye. Given this repo's small maintainer-plus-agents shape today, hand-Shape is lower friction now; the SVG pipeline earns its keep once several hole-needing marks (BMW, VW, Toyota) are tackled together, not for just one.

## 4. SVG source and legal picture

I am not a lawyer. This section separates fact from assessment.

Facts (web): nominative fair use lets an app name a trademark to refer to the real product, but several trademark-attorney sources (Cohn Legal, Avvo Q&As on automaker logos) treat logos and trade dress as riskier than plain text names, since a logo goes beyond "the minimum necessary to identify" the brand. No case specific to a diagnostic app was found either way. Other OBD2 apps (Torque, Car Scanner, FixD family) list dozens of brands by name in their store listings; no documented dispute surfaced in this search, but that is "no evidence of a problem," not "confirmed safe."

Wikimedia Commons' "threshold of originality" policy treats very simple marks made of basic geometric shapes or plain text as below the copyright threshold, tagged `{{PD-ineligible}}` or `{{PD-textlogo}}`, even when the mark is a live trademark (their hosted `File:Honda.svg` is one example). This is a copyright-only carve-out; Commons is explicit that trademark protection can still apply separately. It supports the idea that hand-simplified geometric marks (Citroen, Renault, Mercedes, Volvo, Mitsubishi) are safer to redraw from scratch than to trace, which is what this repo already does for Citroen.

Assessment: drawing simplified geometric marks ourselves is lower risk than tracing an official SVG or embedding a brand asset file, for both copyright and trademark reasons, and showing a user's own connected car's brand mark in a diagnostic context, with no sponsorship claim, fits well inside nominative fair use. Figurative marks (Peugeot's lion, any detailed crest) carry more copyright weight as illustrations, a second, independent reason (beyond legibility) to keep them on the nameplate fallback. A one-line disclaimer ("brand marks shown belong to their respective owners") is cheap and standard practice. This is not legal advice; get real counsel before a wide public release if this becomes a concern. For the current Spain tester stage, risk is assessed as low.

## 5. VIN coverage reality check

Facts (web): a WMI identifies manufacturer, country or region, and vehicle type or division, not always a single unambiguous brand. Large groups hold many WMIs split by brand, country, plant, or division. Stellantis keeps pre-merger WMI prefixes per brand (Jeep, Dodge, Chrysler, Ram, Citroen, Peugeot, Opel, Fiat, DS, Alfa Romeo), which actually helps this repo, since `brand.ts` already keys by that pre-merger identity (for example `VR7`/`VF7` to citroen, `VR3`/`VF3` to peugeot, `W0L`/`VXK` to opel). The messier case is shared plants building badge-engineered siblings, where a WMI can trail the plant's administrative owner rather than the badge on the car. No definitive current list of ambiguous prefixes turned up in this search, a real gap.

Assessment: the existing prefixes look reasonably consistent with documented long-standing national WMI blocks (`VF` France, `WBA`/`WBS` BMW Germany, `WDB`/`WDD` Mercedes Germany, `JT*` Toyota Japan), but this was not exhaustively re-verified against an authoritative WMI registry in this pass, real follow-up work. An unrecognized WMI safely falls back to nothing (`brandFromVin` returns `null`); a wrongly-mapped WMI shows the wrong emblem, a worse failure than showing none. That makes correctness of the existing table matter more than expanding it further, and is a stronger argument for spending geometry effort on brands with unambiguous prefixes (most European mass brands) before exotic multi-badge platforms.

## 6. Approaches and recommendation

Approach A: hand-authored `THREE.Shape` per brand, expand gradually. Extend the existing pattern, geometric marks first. No new dependencies, fits the existing `EMBLEM_CHROME`/`EMBLEM_Y` conventions. Ceiling: letter holes (BMW, VW) are possible by hand but tedious.

Approach B: SVG source plus `SVGLoader`/`ExtrudeGeometry` pipeline. Add a small `src/lib/emblems/<brand>.svg` (or inline path string) per brand, drawn or simplified in-house per section 4, loaded via `SVGLoader.createShapes()` and extruded the same way Citroen is extruded today. Handles holes and curves more gracefully, more contributor friendly, small one-time cost to wire up the loader and a brand-to-path registry next to `brand.ts`.

Recommendation (assessment, planner decides): start with Approach A for the five cheap geometric wins (Renault, Mercedes-Benz, Volvo, Opel, Mitsubishi), since it needs zero new plumbing and matches the pattern file's existing guidance directly. In the same or a follow-up stream, build the Approach B pipeline once there is more than one mark that needs holes or curves (BMW, VW, Toyota's ellipses); building an SVG pipeline for a single mark is not worth it, building it for three is. Keep the figurative tier (Peugeot, Ford, Kia, Skoda, Nissan, Fiat, Mazda) on the nameplate fallback indefinitely.

## Scope: not investigated

- No exhaustive re-verification of every existing WMI prefix against an authoritative registry (SAE/ISO 3780 assignee list), flagged as follow-up.
- No legal consultation; section 4 is web research plus assessment only.
- Did not prototype either technique; no code was written or modified.
- Did not investigate glTF/Draco tooling in depth, ruled out early (see decision log).
- Did not obtain the full paywalled Spain top-20 brand table; section 1's ranking blends the confirmed top 6 with general market assessment.

## 7. Addendum: Spain top-4 extension (Hyundai, Seat, Cupra, Toyota)

Fact (web, 2026 YTD): Spain's new-car brand registrations Jan-Jul 2026 update section 1. Toyota #1 at 9% share (down 0.5% YoY), Volkswagen #2 at 6.7% (down 1.6%), Seat #3 at ~6.1%, Renault #4, Peugeot #5, Kia #6. Full top-6 is confirmed; Peugeot and Kia remain in the close tier A/B boundary. Source: [bestsellingcarsblog.com Spain July 2026](https://bestsellingcarsblog.com/2026/08/spain-july-2026-byd-80-7-ebro-80-4-stand-out-four-new-chinese-brands-arrive/), [April 2026 data](https://bestsellingcarsblog.com/2026/05/spain-april-2026-seat-23-4-peugeot-18-3-shine-in-biggest-april-volume-in-7-years/). This supersedes section 1's paywalled 2025 full-year figure.

### 7.1 Mark geometry details (four brands)

**Toyota** (key `toyota` in brand.ts). Fact (web): three overlapping ellipses — one vertical and one horizontal interlocked to form a "T", both sitting inside a larger outer oval. All edges are pure curves (no straight lines). The mark is symmetrical left-to-right. Source: [inkbotdesign.com Toyota Logo History](https://inkbotdesign.com/history-toyota-logo-design/), [DesignRush](https://www.designrush.com/best-designs/logo/toyota).

**Hyundai** (key `hyundai`). Fact (web): a slanted bold "H" letterform inside an oval ring, creating a hole-in-ring shape. The 2023+ redesign is black/white (vs the older blue). The H has a consistent stroke weight with no serifs. The oval acts as a frame, not filled. Source: [1000logos.net Hyundai](https://1000logos.net/hyundai-logo/), [inkbotdesign.com Hyundai](https://inkbotdesign.com/hyundai-logo/).

**Seat** (key `seat` in brand.ts). Fact (web): a stylized "S" made of two wide horizontal bars and diagonal stripe cuts (piston-ring inspired, or Barcelona Avenue Diagonal inspired depending on source). The 2017-present version is flat black monochrome. The S is a curved band with cuts/stripes through it, not a solid letter. Source: [fabrikbrands.com Seat Logo](https://fabrikbrands.com/branding-matters/logofile/seat-logo-history-meaning-symbol-and-evolution/), [1000logos.net Seat](https://1000logos.net/seat-logo/).

**Cupra** (NOT in brand.ts today). Fact (web): Cupra is Seat's performance sub-brand (spun off ~2018 with its own identity). The car badge is a symmetrical mark made of two overlapping triangular shapes forming an X-shaped symbol. All edges are straight lines (no curves). The mark has sharp, pointed corners and reads as a tribally-inspired angular emblem. Finishes include black, bronze, or chrome. Source: [1000logos.net Cupra](https://1000logos.net/cupra-logo/), [fabrikbrands.com Cupra](https://fabrikbrands.com/branding-matters/logofile/cupra-logo-history-symbol-meaning-and-brand-heritage/).

### 7.2 WMI and brand.ts coverage for Cupra

Fact (web): both Seat and Cupra use the same WMI prefix VSS (Spain, Martorell-built). Cupra vehicles do not have a distinct WMI block; they are distinguished from Seat by model codes in positions 4+ of the VIN. Source: [Scribd VW WMI document](https://www.scribd.com/document/415181124/VW-World-Manufacturer-Identifier-VW), [vindecoderz.com Seat Cupra VIN decoder](https://www.vindecoderz.com/EN/Seat/CUPRA).

Assessment: Cupra cannot be reliably distinguished from Seat via WMI alone. The existing `brand.ts` line `VSS: { key: "seat", name: "SEAT" }` is correct — a VSS VIN always resolves to Seat. Adding Cupra as a separate key would require either (a) a hardcoded model-code lookup (expensive, fragile), or (b) a dev-time override (like the `?vin=` query parameter already supported). For a real Cupra vehicle in the field, its VIN starts with VSS, so it arrives at BrandEmblemModel as `brand.key = "seat"`. This is a fundamental VIN limitation, not a defect in the table. Recommendation: if Cupra geometry is built, it must be gated behind the dev `?vin=` override or a UI brand selector, not auto-detected from the VIN.

### 7.3 Technique evaluation for these four marks

Assessment: all four marks exceed the complexity ceiling of hand-authored `THREE.Shape` (Approach A) in different ways. Toyota needs pure-curve ellipses (tedious bezier curves). Hyundai needs a letterform with an internal hole (the H's aperture). Seat needs curved bands with cut stripes (multiple overlapping paths or complex line-walking). Cupra is the only trivial case (triangles/straight lines).

Specifically: Toyota's three ellipses would require either approximating each ellipse via multiple `bezierCurveTo` segments (noisy, error-prone) or accepting a faceted polygon (reads as square-ish at card size, not as smooth curves, flagged in review.md pattern 1). Hyundai's H-in-ring is a letterform with subtractive holes (the H's internal apertures), which hand-authored `THREE.Shape.holes` can theoretically handle but require manually walking the outline of a letter's serifs and apertures — a maintenance nightmare if the font ever changes. Seat's S with stripes involves either (a) multiple overlapping Shape instances (one for each stripe), (b) hand-walking a complex S-curve outline plus multiple diagonal cut paths (prone to self-intersection bugs), or (c) union operations not supported by `THREE.Shape`.

Fact (web, three.js docs): `SVGLoader.createShapes()` handles all of these gracefully. Ellipses are native SVG curve elements. Letterforms are drawn in any vector app (Figma, Inkscape) with holes auto-detected from fill-rule. Overlapping paths with union operations are resolved by the SVG renderer before conversion to `THREE.Shape`. Cost: a one-time setup to wire `SVGLoader` (ships with three.js, no new package), create a registry mapping brand keys to SVG path data, and load/cache per emblem. This is the same one-time cost flagged in section 6.

Recommendation (assessment, planner decides): the three hard marks (Toyota, Hyundai, Seat) now justify the Approach B (SVGLoader) pipeline. Combined they represent three distinct technical challenges (curves, holes, overlaps) that SVG solves elegantly. Cupra is a bonus: include it as either hand-authored (trivial, low priority) or defer it, since the VSS WMI ambiguity requires special handling anyway. Building Approach B for three marks is justified; building it just for Cupra is not. If the planner chooses to implement Approach A (hand-Shape) for these four despite the complexity spike, Cupra and Toyota are viable (tedious, but possible); Hyundai and Seat should be deferred until Approach B exists. This changes section 6's original recommendation because we now have concrete geometry details confirming three marks exceed the hand-authored ceiling.

### 7.4 Tier ranking updates for Kia and Peugeot

Fact (web): Peugeot moved to tier-A position (top 5 in Spain 2026 YTD). Kia remains tier-A but is sliding (ranked 6th, -11.1% YoY in April). Both brands stay in section 2's nameplate-fallback tier (Peugeot: tier (c) figurative lion/lion-mane; Kia: tier (b) signature wordmark), so no geometry changes recommended. This updates section 1's tier ranking in practical terms but does not change the marks' complexity assessment or recommendation.
