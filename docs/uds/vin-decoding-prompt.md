# VIN decoding prompt (paste-ready)

Version 1.0 · 2026-09-02

A single-purpose pass. Where
[`brand-research-prompt.md`](./brand-research-prompt.md) asks for a whole
research pack, this one asks for exactly one thing: **the rules that turn a
VIN into a platform**, for one brand, with sources.

Run it when a brand's platforms are already described but none of them can be
selected from a VIN — the symptom is `research:validate` reporting a non-zero
`platforms without a VIN classifier`, or a `projection-report.json` whose
`vin_selectable_platforms` is empty. Until that is fixed, every
platform-scoped route in the pack is inert: the planner has a VIN and nothing
to match it against.

## How to use this prompt

1. Pick one brand. One pass covers one brand.
2. Copy everything between the `PROMPT BEGINS` and `PROMPT ENDS` markers into
   a deep-research tool.
3. Replace every double-brace placeholder before sending:

| Placeholder | What to put there |
|---|---|
| `{{brand_id}}` | The lowercase map brand id, for example `honda` |
| `{{marques}}` | The marques the brand id routes, comma separated |
| `{{wmi_codes}}` | The WMI prefixes from the brand's `wmi[]` array |
| `{{platform_list}}` | Paste target. One line per platform the pack or the trusted map already declares: `platform_id · models · year range · powertrains · architecture` |
| `{{markets}}` | The markets to cover, for example `europe` |
| `{{research_date}}` | The date of the pass, `YYYY-MM-DD` |

4. The reader has no repository access. Everything the pass needs is inside
   the prompt block. Do not trim it.
5. Save the two returned files beside the brand's pack and fold them in:
   `vds_patterns` onto the matching `platforms.json` records, gap records
   into `conflicts-and-gaps.json`, sources into `source-ledger.json`
   (renumbering refs to stay unique). Re-hash `index.json`, then re-run
   `pnpm --filter @scainner/uds-map research:validate <pack-dir>` and confirm
   the classifier line dropped.

The normative contract is
[`brand-research-pack-specification.md`](./brand-research-pack-specification.md)
§9.1 and §9.2; the source and anti-fabrication rules are the research
prompt's C12 and C17, reproduced below in the form this pass needs. If this
file and the specification ever disagree, the specification wins and this
file is the bug.

===== PROMPT BEGINS (copy from here) =====

# Role and mission

You are a vehicle-identification research analyst. Your entire deliverable is
the set of rules that classify a vehicle's platform and generation from its
VIN, for one brand, each rule carrying a source that a stranger can check.

You are not producing diagnostic addresses, data identifiers or decoders.
Ignore them entirely.

The output feeds a matcher that runs before any communication with the car.
A rule that is wrong does not fail loudly — it silently routes a car to the
wrong generation's assumptions. So a sourced rule covering two platforms out
of eight is a good pass, and eight confident unsourced rules is a failed one.

# Subject of this pass

- Brand id: `{{brand_id}}`
- Marques routed to this brand id: {{marques}}
- WMI codes: {{wmi_codes}}
- Markets in scope: {{markets}}
- Research date: {{research_date}}

## Platforms to classify

Each line is a platform that already exists. Do not invent new ones, do not
rename these, and do not merge them. Your job is to attach a VIN rule to each
of them, or to say honestly that you cannot.

{{platform_list}}

# Background you need

A VIN is 17 characters, defined by ISO 3779:

```text
positions  1  2  3 | 4  5  6  7  8  9 | 10 | 11 | 12 ... 17
           WMI     | VDS              | MY | plant | serial
```

- **1–3, WMI** — world manufacturer identifier. Already known; not your job.
- **4–9, VDS, the vehicle descriptor section** — six characters. ISO
  3779:2009 §4.3 says their "coding and sequence ... are determined by the
  manufacturer", so there is **no cross-manufacturer standard for what they
  mean**, and allocation differs by market. **This is what you are
  researching.**
- **10** — model year code.
- **11** — assembly plant.
- **12–17** — serial number.

The matcher this feeds evaluates each pattern against **VIN characters
4–10**: the six descriptor characters plus the model-year character.

# Deliverable

Exactly two files, no others.

## 1. `platforms.json`

```json
{
  "schema_version": 1,
  "platforms": [
    {
      "platform_id": "examplebrand_gen2",
      "vds_patterns": ["^KA1HK", "^KB1HK"],
      "market": "europe",
      "positions": "4-8",
      "confidence": "medium",
      "meaning": "K at position 4 is the family; A and B at position 5 are the five-door and estate bodies; 1HK at 6-8 is the engine family sold in this generation.",
      "source_refs": ["S03"]
    }
  ],
  "declared_count": 1
}
```

One object per platform id from the list above — including the ones you could
not classify, which carry `"vds_patterns": []`. A human merges these onto the
existing records, so emit only the fields shown.

Rules for a `vds_patterns` entry:

- Each entry is a plain **string**: a regex in the **shared subset** the
  runtime parses — literal `A-Z` and `0-9`, `.`, `[...]` character classes
  with ranges and negation, `(a|b)` alternation, and the `^`, `$`, `?`, `*`,
  `+` operators. **No `{n,m}` counts, no escapes like `\d` or `\w`, no
  lookaround.** Anything richer is silently dead: the matcher fails to parse
  it and the pattern never fires. `I`, `O` and `Q` never appear in a VIN, so
  they never appear as literals.
- **Anchor every entry with a leading `^`.** Without the anchor the pattern
  is a substring search across the descriptor and will match characters it
  was never meant to describe. If you write alternation inside one entry,
  group it — `^(KA1|KB1)`, never `^KA1|KB1`.
- **One entry per VIN family.** Two families are two strings. Never merge
  them into one loosened pattern; the consuming compiler joins the list into
  a single alternation itself.
- Because the matcher sees characters 4–10, a rule about positions 4–9 is
  anchored at the start and left **open at the end**: `^KA1` constrains
  positions 4–6 and leaves 7–10 free. Add a closing `$` only if you intend to
  constrain the model-year character as well, and then the pattern must
  account for all seven characters.
- `positions` — which characters the patterns are actually about (`"4-5"`,
  `"4-8"`, `"4-9"`). Documentation; it does not change matching.
- `market` — required. Descriptor allocation is per market, so a rule read
  off one market's registry is not evidence for another. If a platform needs
  different rules in two markets, emit it twice with different `market`
  values and say so.
- `source_refs` — at least one, resolving in the source ledger below.
- `confidence` — `low` | `medium` | `high`.
- `meaning` — one sentence saying what the constrained characters encode.
  If you cannot write this sentence, you do not have a rule, you have a
  coincidence.

Two further rules:

- **A pattern is a claim about a generation, never about a nameplate.**
  Nameplates outlive diagnostic architectures and get reused across them, so
  a rule keyed to a nameplate will eventually match a car with a different
  bus, gateway and service set.
- **Never widen a pattern to make it fire.** A single family character on its
  own usually matches other marques routed to the same brand id. If two
  generations cannot be separated by descriptor characters, that is the gap
  record below, not a pattern full of `.` that swallows both.

## 2. `vin-classification-gaps.json`

Every platform you could not classify gets a record. This file is not
optional and an empty one on a first pass is a failed pass.

```json
{
  "schema_version": 1,
  "gaps": [
    {
      "gap_id": "examplebrand_gen3_not_vin_selectable",
      "kind": "platform_not_vin_selectable",
      "scope": { "platform_ids": ["examplebrand_gen3"] },
      "priority": "P1",
      "required_evidence": "A registry or type-approval table mapping this generation's descriptor characters, or two confirmed VINs from known cars of this generation.",
      "safe_next_action": "Classify by model year plus mode 09 calibration identifiers, or by gateway identity, until a descriptor rule is sourced; leave platform-scoped records inert.",
      "retry_condition": "A registry table or a second confirmed VIN appears.",
      "source_refs": ["S03"]
    }
  ],
  "declared_count": 1
}
```

`safe_next_action` must name a **real alternative classifier**, not a
restatement of the problem. The three that the consuming system can actually
use are: model year, mode 09 calibration identifiers read from the car, and
gateway identity. Say which one you think would work and why.

## 3. Source ledger

Append it to `platforms.json` as a top-level `sources` array. Every source
record:

```json
{
  "ref": "S03",
  "title": "National type-approval register, model-code table",
  "url": "https://example.invalid/register/table",
  "source_type": "registry",
  "licence": "CC-BY-4.0",
  "revision": null,
  "retrieved_at": "2026-09-02",
  "scope": "Europe, 2019-2024",
  "reliability": "high"
}
```

Source order and grading for this pass:

| Tier | Source class | Reliability | Requirement |
|---:|---|---|---|
| 1 | Manufacturer or importer VIN documentation; national type-approval or vehicle registers | `high` | A date, and a URL or document identifier that resolves |
| 2 | Public VIN-decoding databases assembled from manufacturer submissions | `high` | Name the query and the date; state the coverage limits |
| 3 | Open-source decoders and diagnostic projects with immutable revisions | `medium` | A 40-character commit or blob SHA, and a URL containing it |
| 4 | Forum threads, parts catalogues and community tables | `low` | A resolvable citation and a stated scope. Never sufficient alone for `high` confidence |
| 5 | Everything else, including your own inference | Not usable | Do not emit a pattern |

Licence gates reuse: record the licence on every source, and never copy a
proprietary table verbatim — cite it and express the rule yourself.

# Anti-fabrication rules

1. **Every pattern resolves to a source.** The platform's `source_refs` exist
   in the ledger, and each ledger entry resolves to the exact page or
   revision cited. No source, no pattern.
2. **A single decoded VIN is not a rule.** One car tells you that one
   descriptor string belongs to that platform. It does not tell you which
   characters carry the meaning. Say so, mark `confidence: "low"`, and state
   what a second VIN or a table would settle.
3. **Conflicts are kept, never averaged.** Two sources disagreeing about a
   character become two entries with their own sources and confidences, not
   one blended pattern.
4. **Unknown is an empty array plus a gap record.** A plausible guess in
   place of an empty array is the worst possible output of this pass.
5. **No sibling inheritance.** Never carry a descriptor rule from a related
   marque or a shared platform because the two "are basically the same car".
   Descriptor allocation is per manufacturer and per market.
6. **No invented identifiers.** Every `platform_id` you emit appears in the
   list above, spelled identically.
7. **Counts must match.** Each `declared_count` equals the length of the
   array it describes.

# Final self-check, print before finishing

Print this as the last thing you output. Do not skip it and do not summarize
it.

1. **Coverage.** `platforms with a sourced VIN pattern: n of m`, then
   `platforms without a VIN classifier: k`, listing those platform IDs.
   `n + k` must equal `m`.
2. **Syntax.** For each pattern string: confirm it starts with `^`, uses only
   the shared subset, groups any alternation, and cannot match an empty
   string. Name any that does not.
3. **Single-source patterns.** Every pattern resting on exactly one source,
   listed with that source's tier.
4. **Tier-4 patterns.** Every pattern whose best source is tier 4, listed.
   None of these may carry `confidence: "high"`.
5. **Market coverage.** For each market in scope, which platforms you covered
   and which you did not.
6. **Honest gaps.** State plainly what you could not establish and what
   evidence would establish it. Name the specific document or register you
   would need, not "more research".

===== PROMPT ENDS =====
