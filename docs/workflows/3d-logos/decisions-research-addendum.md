# Decision log: researcher addendum, 3d-logos section 7

Each block: what, options considered, why, risk.

## Mark geometry verification via web search

What: verified the geometry of four brand marks (Toyota, Hyundai, Seat, Cupra) using web search and Wikimedia Commons references, rather than downloading/analyzing the SVG files directly or testing against actual car badges in the field.

Options: (a) download and parse the SVG files from Commons/brand sites to extract exact curve counts and coordinates, (b) test against real cars or high-res photos to confirm visual accuracy, (c) rely on trade-press design histories and logo-meaning databases as documentation.

Why: (c) balances research effort. Option (a) requires tooling to parse SVG structure and would produce technical metadata (curve counts, coordinates) that becomes obsolete if a brand refreshes its mark; option (b) is out of scope for this research stage (no car access). Trade-press sources provide the semantic geometry description (e.g. "three overlapping ellipses") needed to assess hand-authored vs SVG feasibility. These descriptions came from specialized logo-history sites (inkbotdesign.com, 1000logos.net, fabrikbrands.com) which source their content from brand guidelines or documented design evolution.

Risk: a brand's official mark may differ subtly from the popular web descriptions (e.g. actual curve count in Toyota's ellipses differs from "three overlapping ovals" if one is off-center). Mitigated by flagging this as assessment only and by noting that section 3's SVGLoader approach handles curve approximation automatically from SVG sources anyway.

## Cupra's missing WMI and brandFromVin ambiguity

What: determined that Cupra and Seat share the VSS WMI prefix (no separate Cupra manufacturer code exists), and recommended that Cupra cannot be auto-detected from VIN alone, instead requiring developer override or UI selection.

Options: (a) add Cupra as a separate key in brand.ts with its own manufactured WMI guesses (e.g. VSS → cupra instead of seat for some year/model range), (b) add Cupra to branch.ts with VSS but flag it as requiring manual UI selection, (c) defer Cupra entirely since it's a sub-brand without independent VIN distinction.

Why: web sources confirm VSS is shared; real Cupra cars in the field have VSS VINs. Option (a) would require maintenance of a model-code lookup table (which model codes indicate Cupra vs Seat for the same WMI) — a maintenance burden that grows with each Cupra generation. Option (b) flags the ambiguity and pushes it to the UI layer, which is cleaner. Option (c) is unnecessarily conservative since the dev `?vin=` override mechanism already exists to test Cupra geometry locally.

Risk: if a future Cupra model somehow gets assigned a distinct WMI by VW Group (unlikely but possible), the recommendation to always map VSS → Seat would silently mis-identify those cars. Mitigated by documenting this as a flagged limitation (as done in section 7.2).

## Approach B (SVGLoader) recommendation reversal

What: the initial research.md section 6 recommended starting with Approach A (hand-authored THREE.Shape) for the first five cheap geometric marks, deferring Approach B (SVGLoader) until three hole/curve marks were tackled together. The addendum now recommends Approach B upfront for the Spain top-4 marks (Toyota, Hyundai, Seat, Cupra), reversing that recommendation.

Options: (a) stick with Approach A and accept tedious hand-authored bezier curves for Toyota, awkward manual hole-walking for Hyundai, and complex multi-shape unions for Seat, (b) adopt Approach B immediately for these three marks only, (c) split: Cupra goes into the existing Approach A plan, Toyota/Hyundai/Seat defer to a future Approach B stream.

Why: section 7.3's detailed mark analysis shows three distinct technical challenges (curves, holes, overlaps) that exceed Approach A's practical ceiling. Toyota alone is borderline; combined, the three justify one-time SVGLoader setup. This is not overturning the original recommendation (which was sound when no concrete geometry details existed) but rather applying it with new facts: the original criterion was "once there is more than one mark that needs holes or curves." We now have exactly three such marks, in a single related batch (Spain's most common brands), which justifies immediate pivot to Approach B rather than spreading the work across multiple increments.

Risk: Approach B carries implementation risk if SVGLoader doesn't parse a particular brand's simplified geometry as expected (e.g. fill-rule edge cases); this is mitigated by the existing SVGLoader.createShapes() documentation (section 3) confirming it's the preferred modern pattern for exactly this use case. A second risk is that the builder might prototype Approach A first, only to discover hand-authored Hyundai/Seat are too painful, forcing rework; mitigated by flagging this analysis upfront in the decision log so the planner can avoid that path.

## Spain market data recency and tier-ranking impact

What: replaced the paywalled 2025 full-year figure in section 1 with confirmed Jan-Jul 2026 YTD data from bestsellingcarsblog.com, without waiting for a full confirmed 2026 year-end report.

Options: (a) wait for end-of-2026 full-year data to be published, (b) use the Jan-Jul snapshot as a forward-looking signal of market direction (this is what was chosen), (c) keep the old 2025 paywalled ranking and note that it is stale.

Why: (b). The YTD 2026 data is more recent and covers 50% of the year (a statistically fair sample); it shows the same top-4 (Toyota, VW, Seat, Renault) plus confirmed positions for Peugeot and Kia. Waiting for end-of-2026 would delay this research release by several months for marginal benefit (the top-4 order is unlikely to shift that much in 5 months). The data point is 2 weeks old at time of writing (published 2026-08-08ish) and is factual, not a projection.

Risk: the July data might be an outlier (summer selling patterns differ from spring); if so, mid-year ranking positions could shift by August. Mitigated by treating the top-4 as stable (they were confirmed top-4 in 2025 and in April 2026) and Peugeot/Kia as trending but not definitively ranked (noted as "close tier A/B boundary").

## Toyota's ellipse complexity: hand-authored bezier vs SVGLoader

What: assessed Toyota's three overlapping ellipses as "tedious but possible" via hand-written THREE.Shape.bezierCurveTo(), vs "trivial" via SVGLoader, but flagged that hand-authored bezier approximation reads as square-ish/faceted at card size unless the curve segment count is high.

Options: (a) hand-author Toyota's geometry using enough bezierCurveTo segments to approximate the ellipses smoothly (e.g. 12+ segments per ellipse), accepting the code maintenance burden and higher triangle count, (b) defer Toyota to Approach B so the ellipses are parsed directly from SVG curves, (c) approximate Toyota as three overlapping circles (simpler hand-authored geometry, less accurate visually).

Why: option (b) is now recommended by section 7.3, so options (a) and (c) are moot. But documenting the trade-off here: option (a) was the fallback if Approach A had been chosen. Option (c) would have been faster but less recognizable (a Toyota badge made of circles instead of ellipses looks subtly wrong to anyone familiar with the actual logo).

Risk: if option (a) had been chosen, the bezierCurveTo code would be dense and hard to verify by eye; a typo in one curve's control points would render as a discontinuous bump. Mitigated by switching to option (b).

## Trusted sources

What: treated bestsellingcarsblog.com as authoritative for Spain 2026 YTD sales data (even though the site is a single source), and treated specialized logo-history sites (1000logos.net, inkbotdesign.com, fabrikbrands.com) as reliable sources for mark geometry descriptions.

Options: (a) discount these sources and cite "we do not have authoritative data," (b) use them and flag the single-source limitation, (c) require primary sources (brand guidelines, VIN decoder WMI registries) for every fact.

Why: (b). The blog publishes monthly reports with consistent methodology; the logo-history sites curate from official brand guidelines and design documentation. Option (a) would block the research with no gain. Option (c) is overly strict for an assessment phase (brand guidelines are often paywalled or internal). The limitations are already flagged in section 1 and section 7.1.

Risk: none beyond what is disclosed inline.
