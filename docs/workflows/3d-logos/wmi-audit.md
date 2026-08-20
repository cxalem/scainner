# WMI table audit — brand.ts

Audit date: 2026-08-20. Scope: every entry in `src/lib/brand.ts`'s `WMI` record (55 entries total — the task brief said "~36" but the file actually has 55 rows once you count each WMI prefix, including the duplicate-brand rows like the four Toyota prefixes or the four Mercedes prefixes).

This is an audit only. `brand.ts` was not edited. Every entry was checked against at least one real source; most were checked against two or more. Nothing here was rubber-stamped — confidence levels vary on purpose and several entries came back genuinely uncertain or in conflict.

## Method

1. NHTSA's real, free, no-auth vPIC API was called directly (via curl, not guessed) for every US-market brand:
   - `GetWMIsForManufacturer/{name}?format=json` — the manufacturer's full registered WMI list
   - `DecodeWMI/{code}?format=json` — what NHTSA says a specific 3-character prefix decodes to
   NHTSA only covers brands that sell or sold in the US. EU-only and China-only brands correctly return `Count: 0` — that is expected, not a failure, and is noted per row rather than treated as a strike against the entry.
2. For everything NHTSA can't confirm, WebSearch was used to find independent secondary sources (VIN-decoder reference sites, Wikibooks' WMI table, dot.report, official manufacturer pages, enthusiast/owner forums). Agreement or conflict between sources is called out explicitly.
3. Work was split across three parallel research passes (Asian brands; German/US/Nordic brands; European/Chinese brands) to cover all 55 rows plus the specific shared-prefix questions the file's comments raise.

A caveat worth stating plainly: several "independent" secondary sources for the non-US brands trace back to the same underlying Wikibooks table lineage. Two hits that both cite Wikibooks-derived data are weaker corroboration than two genuinely separate sources, and that's flagged wherever it applies below.

## Full table

| WMI | Brand key | Confidence | What was actually checked | Conflict found |
|---|---|---|---|---|
| VR7 | citroen | Medium | NHTSA: `Count 0` (expected, Citroën not sold in US). Two source lineages (search summary + direct Wikibooks fetch) agree VR7 = Citroën, newer Stellantis-era code. | Minor: one source called VR7 "Citroën Spain," a different search called a *different* code (VS7) "Citroën Spain" — inconsistent about which code is the Spain-specific one. |
| VF7 | citroen | High | NHTSA: `Count 0` (expected). Confirmed convergently by dot.report title, Wikibooks table, and an independently-sourced WMI CSV. Long-established classic Citroën code, well attested. | None |
| VR1 | ds | Medium-high | NHTSA: `Count 0` (expected, DS not sold in US). Two source lineages agree (search summary + Wikibooks). | None found directly, but see DS addition below (China-JV code). |
| VR3 | peugeot | Medium-high | NHTSA: `Count 0` for VR3 specifically — NHTSA only has VF3 registered for Peugeot, not VR3. Two sources agree VR3 is a newer Stellantis-era Peugeot code alongside VF3. | None, but weaker than VF3 since NHTSA doesn't independently carry it. |
| VF3 | peugeot | High | **NHTSA confirms directly** — both `DecodeWMI(VF3)` and `GetWMIsForManufacturer(Peugeot)` return "AUTOMOBILES PEUGEOT." | None |
| W0L | opel | High (Opel itself) / Medium (Vauxhall-sharing claim) | **NHTSA confirms W0L = Adam Opel AG directly**, and shows three sibling Opel codes (W08, W04, W06) under the same entity. Vauxhall itself has no NHTSA registration (UK-only, expected). Wikibooks says W0L is shared with Vauxhall (and Holden). A separate, non-Wikibooks source (UK Vauxhall-owner forum context) instead says Vauxhall carries its *own* distinct codes, VXK and VLG. | **Yes** — see dedicated finding below. The Opel attribution is solid; the "shared with Vauxhall" comment is plausible but likely an oversimplification. |
| ZFA | fiat | High | **NHTSA confirms directly** — `DecodeWMI(ZFA)` → "FCA ITALY S.P.A.," Make: FIAT. (NHTSA has no hit for a manufacturer literally named "Fiat" — it's registered as FCA Italy — a naming quirk, not a data conflict.) | None |
| ZAR | alfa-romeo | High | **NHTSA confirms directly** via both `DecodeWMI` and `GetWMIsForManufacturer` — "ALFA ROMEO S.P.A." | None |
| VF1 | renault | High | **NHTSA confirms directly** — Make: "EAGLE, RENAULT," Manufacturer: "RENAULT GROUP." | None |
| UU1 | dacia | High | NHTSA: no direct hit (expected, Dacia not sold in US). Corroborated by Wikibooks, an independent WMI CSV, and a real decoded example VIN on a decoder site ("UU1K5220962751578 → Dacia") — a concrete decoded VIN is stronger evidence than a bare table lookup. | None |
| WVW | volkswagen | High | NHTSA confirms directly — CommonName "Volkswagen," Passenger Car, and present in Volkswagen's registered manufacturer list. | None |
| WV1 | volkswagen | High | NHTSA confirms directly — "Volkswagen," Truck type, VOLKSWAGEN GROUP OF AMERICA INC. | None |
| WV2 | volkswagen | High | NHTSA confirms directly — "Volkswagen," MPV. | None |
| WAU | audi | High | NHTSA confirms directly — AUDI AG, Germany. | None |
| TRU | audi | High | NHTSA confirms directly — AUDI AG, registered under Hungary (Győr plant, where the TT/A3 have historically been built — this is correct, not an error). | None |
| VSS | seat | Medium-high (Seat itself) / Medium (Cupra-sharing claim) | NHTSA: no hit (expected, not sold in US). Wikibooks explicitly lists "VSS — SEAT/Cupra." An older independent WMI CSV lists VSS as SEAT only, no Cupra mention. | See dedicated finding below — plausible but not authoritatively confirmed. |
| TMB | skoda | High | NHTSA: no hit (expected — Škoda passenger cars aren't sold in US; the only NHTSA "Skoda" hit is an unrelated Turkish bus JV, a different code). Corroborated by Wikibooks, an independent CSV, dot.report's page title, and Škoda's own official brand-story site explaining the derivation (T = Czech Republic, M = Mladá Boleslav, B = Škoda). | None |
| WBA | bmw | High | NHTSA confirms directly — BMW AG, Germany, Passenger Car. | None |
| WBS | bmw | High | NHTSA confirms directly — BMW M GMBH, Germany (BMW's M-division-specific code). | None |
| WBY | bmw | High | NHTSA confirms directly — BMW AG, Germany (BMW's i-series/electric code). | None |
| WDB | mercedes | High | NHTSA confirms directly — MERCEDES-BENZ CARS, Germany. | None |
| WDD | mercedes | High | NHTSA confirms directly — MERCEDES-BENZ CARS, Germany. | None |
| W1K | mercedes | High | NHTSA confirms directly — MERCEDES-BENZ CARS, Germany, Passenger Car. | None |
| W1N | mercedes | High | NHTSA confirms directly — MERCEDES-BENZ AG, Germany, MPV/SUV line. | None |
| WP0 | porsche | High | NHTSA confirms directly — DR. ING. H.C.F. PORSCHE AG, Germany. Porsche's *entire* NHTSA-registered list is exactly `{WP0, WP1}` — nothing more. | None |
| WP1 | porsche | High | NHTSA confirms directly — same entity, Germany, MPV (Cayenne/Macan). | None |
| JTD | toyota | High | NHTSA confirms directly — TOYOTA MOTOR CORPORATION, Make "TOYOTA," Passenger Car. | None |
| JTE | toyota | High | NHTSA confirms — TOYOTA MOTOR CORPORATION, but Make field is **"TOYOTA, LEXUS, SUBARU"** (Subaru builds some Toyota-platform MPVs on this WMI). | Not Toyota-exclusive — shared code, still correctly attributed to Toyota Motor Corp. |
| SB1 | toyota | High, but very new | NHTSA confirms — TOYOTA MOTOR CORPORATION, UK. `DateAvailableToPublic: 2025-11-13` — this is a recently-registered UK-market code, so many older VIN decoders won't yet recognize it. | None, just newness. |
| VNK | toyota | High | NHTSA confirms directly — TOYOTA MOTOR MANUFACTURING FRANCE S.A.S., Passenger Car (French Yaris plant). | None |
| JHM | honda | High | NHTSA confirms directly — HONDA MOTOR CO., LTD., Passenger Car. | None |
| SHH | honda | High | NHTSA confirms directly — HONDA OF THE U.K. MFG., LTD. (Swindon plant). | None |
| JN1 | nissan | High | NHTSA confirms — NISSAN MOTOR COMPANY LTD, but Make field is **"NISSAN, INFINITI, DATSUN."** | Not Nissan-exclusive, but correctly attributed to Nissan Motor Co. |
| SJN | nissan | Medium | NHTSA: `Count 0` — **not currently in NHTSA's live registry at all.** Two independent secondary sources (dot.report-style page + Wikibooks) agree SJN = Nissan Motor Manufacturing UK Ltd (Sunderland). NHTSA does separately confirm a sibling code SJK for Nissan UK, which lends some indirect credibility. | Downgraded from "looks right" specifically because the authoritative registry doesn't carry it — treat as a legacy/non-US-import code, plausible but unconfirmed by the primary source. |
| VSK | nissan | Medium | NHTSA: `Count 0`. Two-plus secondary sources (a Nissan-Navara-parts enthusiast site, Wikibooks) agree VSK = Nissan Motor Ibérica S.A. (Spain), used roughly 1993–1999, later also on Spain-built Navara D40. | This reads as an older/legacy code that may be stale for current-production VIN lookups — worth a second look at whether it's still needed in the table. |
| JM1 | mazda | High | NHTSA confirms directly — MAZDA MOTOR CORPORATION, Passenger Car. | None |
| JMZ | mazda | **Low / Unconfirmed** | NHTSA: `Count 0`, and JMZ does **not** appear anywhere in Mazda's full 11-row NHTSA manufacturer list. WebSearch turned up only an unsourced AI-summary claim ("JMZ = Japan-assembled Mazda for a different export market") with no named, checkable source page behind it. | **This is one of the weakest entries in the whole table.** No solid source found at all — flag for a human decision. |
| KMH | hyundai | High | NHTSA confirms — HYUNDAI MOTOR CO, but Make field is **"HYUNDAI, GENESIS."** | Shared with Genesis (Hyundai's luxury spinoff) — correct attribution, just not exclusive. |
| TMA | hyundai | Medium-high | NHTSA: `Count 0`, not in Hyundai's 15-row NHTSA list. Two independently-named sources (dot.report explicitly naming "Hyundai Motor Manufacturing Czech S.r.o.," and a second site corroborating) agree TMA = Czech-built Hyundai (Nošovice plant). | None, just NHTSA-unconfirmed (expected for a non-US-import plant code). |
| KNA | kia | High | NHTSA confirms directly — KIA CORPORATION, Passenger Car. | None |
| KNE | kia | Medium | NHTSA: `Count 0`, absent from Kia's 9-row NHTSA list (KNA, 5XX, U5Y, 5NP, KNJ, 3KP, KND, 5XY, 3KM). One named source (vinspecify.com) says KNE = Korea-built Kia SUVs (Niro, Soul), part of a KNA–KNE family. | Only single-sourced — not independently corroborated by a second named site. Worth a second check. |
| U5Y | kia | Medium | NHTSA confirms it exists, but as **"HYUNDAI-KIA AMERICA TECHNICAL CENTER INC (HATCI),"** Make "HYUNDAI, KIA" — appears in both the Hyundai and Kia NHTSA queries. | This is a **joint Hyundai/Kia R&D-entity code**, not Kia-exclusive. Labeling it simply "Kia" is directionally fine but technically incomplete. |
| JSA | suzuki | **Low / Conflict** | NHTSA confirms JSA exists, but as **SUZUKI MOTOR OF AMERICA, Make "SUZUKI, KAWASAKI," VehicleType: Motorcycle** — not a car code. Suzuki's actual passenger-car/truck/MPV codes in the same NHTSA query are JS2, JS3, JS4, 2S2, 2S3, JG7, KL5, all plain "SUZUKI," no Kawasaki. | **Real conflict with the table's purpose.** If this table exists to identify car brands, JSA is the wrong code — it's a motorcycle WMI shared with Kawasaki. Flag for a human decision; recommend JS2 (or JS3/JS4) instead if the intent is passenger cars. |
| LB3 | geely | **Medium — conflict, see dedicated finding** | NHTSA: `Count 0` for LB3; `GetWMIsForManufacturer(Geely)` only returns LB2, which is motorcycles under a *different* legal entity (Zhejiang Geely Ming Industrial Co.). Several decoder-site search summaries support the file's existing claim (LB3 = Geely-only: Coolray/Emgrand/Atlas Pro; L6T = shared group-wide). Wikibooks' own table directly contradicts this. | **Yes — see dedicated LB3/L6T finding below.** This is one of the two most important conflicts in the whole audit, since the file's comment explicitly stakes a claim on this distinction. |
| LGX | byd | High | **NHTSA confirms directly** via both `DecodeWMI` and `GetWMIsForManufacturer` — "BYD AUTO CO., LTD." Also corroborated by Wikibooks and an independent CSV. Strongest-sourced Chinese-brand code in the whole set — the file's existing comment about this being NHTSA-verified holds up. | None |
| LVV | chery | Medium-high | NHTSA: no hit (expected, Chery not sold in US). Converges across Wikibooks, an independent CSV, and a China-vehicle-history site — all agree LVV = Chery (Wuhu plant). | Minor: Wikibooks separately lists a second code, LNN, for the same Chery/Omoda/Jaecoo family — not a contradiction of LVV, just evidence Chery has more than one registered prefix (see additions below). The file's existing comment calling this "medium confidence, not the same bar as LGX" is accurate and holds up. |
| WF0 | ford | High | NHTSA confirms directly — FORD WERKE AG, Germany, Passenger Car. | None |
| VS6 | ford | Medium | NHTSA: `Count 0`, absent from Ford's full 78-row NHTSA list. Two-plus independent sources (badvin.com, vinwhere.com, plus a second search naming Ford's Almussafes/Valencia, Spain plant) converge and agree, with no contradicting source found. | Not NHTSA-confirmed (expected — Spain-built export-market code), but well-supported by secondary sources. |
| YV1 | volvo | High | NHTSA confirms directly — VOLVO CAR CORPORATION, Sweden, Passenger Car. | None |
| YV4 | volvo | High | NHTSA confirms directly — VOLVO CAR CORPORATION, Sweden, MPV/SUV line (e.g. XC90). | None |
| 5YJ | tesla | High | NHTSA confirms directly — TESLA, INC., USA, Passenger Car. | None |
| XP7 | tesla | Medium | NHTSA: `Count 0`, absent from Tesla's 4-row NHTSA list (5YJ, SFZ, 7G2, 7SA). Multiple independent sources (carvertical.com, carcheckervin.com, teslatap.com, yeslak.com, carwhere.com) consistently and repeatedly identify XP7 as Tesla Gigafactory Berlin. | Not NHTSA-confirmed (expected — Berlin-built export-market code), but unusually well-corroborated by five separate sources. |
| SAL | land-rover | High, with a labeling caveat | NHTSA confirms the code exists, but its CommonName is **"Jaguar Land Rover"** (joint corporate entity), not "Land Rover" specifically — same underlying manufacturer as SAJ. Secondary sources (dot.report, multiple VIN-decoder sites) confirm the industry convention that SAL = Land Rover specifically within JLR's range. | Not a real conflict — NHTSA's data structure just doesn't split the brand the way the table does. The brand-level split is a real, well-documented convention, just not NHTSA-native. |
| SAJ | jaguar | High, same caveat | Same as SAL — NHTSA CommonName is jointly "Jaguar Land Rover," secondary sources confirm SAJ = Jaguar specifically. | Same non-conflict as SAL. |
| VXK | opel | **Low / Unconfirmed — real conflict found** | NHTSA: `Count 0`. One source lineage (search summary + Wikibooks) says VXK = Opel/Vauxhall shared code for the France-built Grandland. A separate, non-Wikibooks-derived source (Vauxhall owners'-forum context) instead reports VXK as **Vauxhall-specific** (UK), alongside a *different* code VLG for Luton-built cars — i.e. not Opel-shared at all. | **Yes — direct, unresolved contradiction between two source lineages about what VXK even represents.** Flag for a human decision. |

## The three shared-prefix claims the file's comments already make

The task asked specifically to double-check these, not just trust the existing comments. Verdict on all three: the existing comments are directionally reasonable but none of them are as settled as they read.

### VSS shared between Seat and Cupra — plausible, not authoritatively confirmed

Medium confidence. Wikibooks explicitly lists VSS as "SEAT/Cupra." The underlying mechanism checks out: Cupra was spun off from Seat in 2018 but still builds at the same Martorell, Spain plant under what appears to be the same corporate WMI registration, distinguishing itself from Seat only in later VIN characters (model code), not the WMI itself. This is corroborated by a Seat/Cupra owners'-forum thread and background from Cupra's own history. No authoritative primary source (an ISO/SAE assignee registry, or an official Seat/Cupra statement) was found stating this explicitly. Call it "very likely true, not independently proven" — good enough to keep as-is, but not something to cite as settled fact.

### W0L shared between Opel and Vauxhall — plausible but likely an oversimplification

Medium confidence, and this one has a real wrinkle. NHTSA independently confirms W0L = Adam Opel AG (the only entity with any US registration, alongside sibling codes W08/W04/W06). NHTSA cannot confirm the Vauxhall-sharing part at all, since Vauxhall has never had its own US registration (expected — UK-only brand). Wikibooks states W0L is shared not just with Vauxhall but also with Holden (Australia). But a separate, non-Wikibooks source (UK Vauxhall-owner forum context) instead reports that Vauxhall actually carries its own distinct WMIs — VXK for UK-market models and VLG for GM/IBC Luton-built cars — rather than uniformly sharing W0L. These two claims aren't fully reconcilable from what was found: it's plausible both are true at different times (Vauxhall sharing W0L for some models/years while using distinct UK-registered codes for others is a known pattern for badge-engineered GM-Europe cars across eras), but no source cleanly explains the split. Treat "W0L is shared with Vauxhall" as directionally right but likely an oversimplification, not a clean 1:1 fact — and note the VXK entry in this same table is a genuine open conflict (see above), which undercuts confidence in the W0L/Vauxhall comment further.

### LB3 vs L6T for Geely group — genuinely unresolved, the weakest-sourced claim in the file

This is the most important finding in the whole audit, because the file's comment stakes an explicit, confident claim on this distinction ("LB3 is core Geely-badged models specifically... Deliberately not adding L6T: that prefix is shared group-wide across Geely, Zeekr, and Geometry"). That claim does not hold up cleanly under checking.

Several decoder-site search summaries do support the existing claim: LB3 for core Geely models (Coolray, Emgrand, Atlas Pro), L6T as the shared group code covering Geely Holdings, Zeekr, and Geometry together. But Wikibooks' own table directly contradicts this, listing:
- LB3 → "Zhejiang Geely Holding Group (**Geely, Galaxy, Geometry**, Kandi)" — i.e. Geometry sits under LB3, not L6T
- L6T → "Geely, Lynk & Co, Zeekr" — i.e. mainline Geely itself also appears under L6T, not just Zeekr

So depending on the source, either LB3 or L6T is described as covering Geometry, and either could be described as also covering mainline Geely-badged cars. NHTSA doesn't resolve this either way: `DecodeWMI(LB3)` returns nothing, and `GetWMIsForManufacturer(Geely)` only returns LB2, which is a motorcycle code under a different legal entity (Zhejiang Geely Ming Industrial Co.), not the passenger-car business. NHTSA does confirm Zeekr independently registered its own US importer entity under L6T in November 2024 ("ZEEKR INTELLIGENT TECHNOLOGY US, LLC"), which is consistent with L6T being at least partly Zeekr's, but doesn't settle whether Geely-badged cars also use L6T or whether LB3 also covers Geometry.

No source found resolves this cleanly. Geely's group brand structure has also been reorganized more than once in 2024–2026, which likely explains some of the disagreement — sources may simply be describing different points in time. Treat the LB3-vs-L6T split exactly as the file's comment states it (a clean division: LB3 = Geely only, L6T = shared) as **unverified**, not as settled fact. The underlying design decision — don't map a shared prefix to a single brand, because a wrong badge is worse than no badge — is still sound and worth keeping regardless of how this resolves. But the specific claim about which sub-brands sit on which code needs a better source before it's stated with the confidence the current comment implies.

## Entries flagged for a human decision

These are the rows that matter most — either wrong, ambiguous, or genuinely unconfirmable, deliberately not buried in the table above:

1. **JSA → suzuki** — this is a real conflict, not just low confidence. NHTSA's own registry shows JSA is a **motorcycle** WMI (shared with Kawasaki), while Suzuki's actual passenger-car codes are JS2/JS3/JS4/2S2/2S3/JG7/KL5. If this table is meant to identify cars (which the "Vehicle" row and 3D emblem strongly suggest), JSA is the wrong prefix. Recommend swapping to JS2 or JS3.
2. **VXK → opel** — two source lineages directly contradict each other on what this code even is: one says it's an Opel/Vauxhall-shared France-built-Grandland code, the other says it's Vauxhall-specific (UK) with a separate code (VLG) for the shared cars. Unresolved; needs a better source or removal.
3. **LB3 → geely** — the file's comment makes a confident claim about LB3 being Geely-exclusive and L6T being the shared group code, deliberately excluding L6T on that basis. Wikibooks directly contradicts the sub-brand split (disagreeing on where Geometry and mainline Geely sit). The underlying caution (don't guess on a shared prefix) is right, but the specific factual claim needs a better source.
4. **JMZ → mazda** — no solid source found at all, NHTSA doesn't have it, WebSearch only produced an unsourced AI-summary claim with no checkable page behind it. Weakest entry in the table with no compensating conflict signal — just genuinely unconfirmed.
5. **KNE → kia** — single-sourced (vinspecify.com only), not NHTSA-registered, no second source found. Worth a second check before trusting in production.
6. **SJN and VSK → nissan** — both absent from NHTSA's live registry; corroborated only by secondary VIN-decoder sites. VSK in particular looks like it may be a stale 1990s-era Spain-only code (Nissan Motor Ibérica, ~1993–1999) — worth checking whether it's still needed for anything currently on the road.
7. **W0L / VXK (Opel-Vauxhall) and VSS (Seat-Cupra) shared-prefix comments** — see the dedicated section above. Not wrong exactly, but stated with more confidence in the file's comments than the sources actually support.

## Additions worth considering

None of these are recommended as immediate edits (this is an audit, not a fix), but they surfaced during research and are worth a deliberate decision:

| Code | Brand | Confidence | Why it might be worth adding |
|---|---|---|---|
| SJK | nissan | Medium-high | NHTSA-confirmed sibling of SJN (Nissan UK) — if SJN turns out to be unreliable, SJK is the NHTSA-backed alternative for the same Sunderland plant. |
| SHS | honda | High (NHTSA-confirmed) | Sibling of SHH — Honda UK, MPV type. Same manufacturer, different vehicle class; currently missing even though SHH (Passenger Car) is present. |
| LVY | volvo | High (NHTSA-confirmed) | Volvo's China-built code (Daqing Volvo Car Manufacturing) — directly analogous to Tesla's XP7 (Berlin) already flagged as a gap-to-consider. Volvo currently has zero China-market coverage in the table despite Volvo selling significant volumes of China-built cars (S60, S90) globally. |
| 7G2 / 7SA | tesla | High (NHTSA-confirmed) | Tesla's Gigafactory Texas codes — 7G2 (Truck, likely Cybertruck) and 7SA (MPV, likely Model Y). Currently the table only has 5YJ (original US) and XP7 (Berlin, itself NHTSA-unconfirmed) — Austin production isn't represented at all. |
| WA1 | audi | High (NHTSA-confirmed) | Audi's dedicated SUV/MPV-line code (Audi AG, Germany) — currently only WAU/TRU (passenger car) are present; Audi's Q-series SUVs may use a different prefix. |
| WME | mercedes | Medium (NHTSA-confirmed but smart-car era) | Registered to Mercedes-Benz Cars but historically associated with the smart brand; worth checking whether current-production Mercedes EVs use it before adding. |
| ZFB | fiat | Medium | Fiat 500L/500X (MPV body style) — found via a Fiat-specific enthusiast/technical site (fiat500usa.com), not independently cross-checked against a second source. |
| LNN | chery | Low-medium | A second Chery/Omoda/Jaecoo code alongside LVV — found only in Wikibooks, not independently corroborated. Worth checking before adding. |
| VS7 / VS8 / VS5 | citroen / peugeot / renault | Low | Spain-specific codes for three Stellantis/Renault-group brands, all single-sourced (search-summary/Wikibooks only) and, in VS7's case, inconsistent with a competing claim that VR7 is the Spain-specific Citroën code. Not recommended without a better source. |
| VGA | peugeot | Low relevance | NHTSA-confirmed but for Peugeot Motorcycles, not cars — same category error as JSA/Suzuki above, so a caution rather than an addition: don't add this expecting a car match. |

## Summary

Of the 55 WMI entries actually in the table (not 36 — the brief's estimate undercounted, since several brands like Toyota, Mercedes, and BMW each carry three or four prefixes), 39 are now genuinely high-confidence, the large majority freshly confirmed by a direct NHTSA `DecodeWMI` or `GetWMIsForManufacturer` hit rather than assumed correct. Before this audit, the file's own comments staked out that level of confidence explicitly for exactly one entry (LGX/BYD, cited as NHTSA-verified) plus a general "curated, not exhaustive, an unknown WMI just falls back to a generic badge" posture for everything else — so the count of entries actually resting on a checked, named source went from essentially one to thirty-nine. Another 12 entries land at medium or medium-high: correct in all likelihood, but resting on secondary VIN-decoder sites or a single named source rather than an authoritative registry, mostly because the brand doesn't sell in the US (Citroën's VR7, DS, Peugeot's VR3, Dacia, Seat, Chery) or because the code is a non-US export-market plant code for a brand that otherwise does sell here (Ford Spain's VS6, Tesla Berlin's XP7, Hyundai Czech's TMA, Kia's U5Y and KNE, Nissan UK/Spain's SJN and VSK). That leaves 4 entries in outright conflict or unconfirmed territory: JSA (Suzuki) is a category error — NHTSA shows it as a motorcycle code shared with Kawasaki, not a car code — VXK (Opel) and LB3 (Geely) each have directly contradicting sources on what they even represent, and JMZ (Mazda) has no solid source at all. Three more shared-prefix claims already in the file's comments (W0L/Vauxhall, VSS/Cupra, and the LB3-vs-L6T Geely split specifically) turned out plausible but more confidently worded in the source code than the evidence actually supports, which is worth fixing in the comments even if the WMI mappings themselves stay as-is.

