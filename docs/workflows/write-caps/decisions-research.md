# Decision log: researcher, write-caps

Each block: what, options considered, why, risk.

## Treating BSI unreachability as a hardware/wiring fact, not a to-do

What: took `UDS_INVESTIGATION_LOG.md`'s conclusion (BSI silent on both
11-bit and 29-bit addressing, two independent sessions, most likely a
physical gateway/pin-routing limit of the OBD-II port) as settled fact for
this research, rather than listing "reach BSI" as an open candidate
feature.
Options: (a) treat it as unresolved and include a "investigate BSI access"
candidate, (b) trust the prior session's own "wall confirmed at every
layer we can touch; topic closed" verdict.
Why: (b). The log is this repo's own hardware knowledge, written by a
prior session that ran the actual probes against the actual car twice.
Re-litigating a closed, double-confirmed dead end would waste research
budget instead of building on it, and the role file says the repo's
reality outranks general knowledge.
Risk: low. If a future car (non-C4, or a firmware update) changes this,
the finding is car-specific and already labeled as such in section 2.

## Distinguishing the security-access wall as legal/ethical, not just technical

What: explicitly separated "can this dongle send a `27` seed/key exchange"
(yes, technically) from "should Scainner do this" (flagged as an ethics
line, not answered here).
Options: (a) present security access purely as a technical capability
question, (b) name the ethical dimension explicitly since PSA's algorithm
is public but still governs someone else's ECU firmware.
Why: (b). The task brief asked to be honest about the security-access
wall specifically, and a purely technical framing would understate the
real reason this project hasn't gone there — it's a product/values
decision as much as an engineering one, and the planner needs that framed
correctly to make the call.
Risk: this is a judgment call, not a fact — flagged as such (candidate #5
in the ranked table, not folded into the "doable" column as a simple yes).

## Using PSA-dedicated aftermarket tools (PSACOM, Stellacan), not just OBDeleven/Carly, as the competitor bar

What: added PSACOM/Stellacan to the competitor matrix after discovering
mid-research that OBDeleven has no Stellantis license and Carly's PSA
depth is thin, rather than stopping at the two brands named in the task
brief.
Options: (a) report only on OBDeleven/Carly/Launch/Autel/Diagbox as
literally named, noting OBDeleven doesn't apply, (b) search further for
PSA-specific tools once the named ones came up light, since the research
question is "what does the competitive landscape ship for PSA," not
"what do these five specific brands ship."
Why: (b). Stopping at "OBDeleven doesn't support PSA" would have left a
real gap in the picture — PSA-dedicated tools are the actual mid-tier
competitor on this exact platform, and they're a closer analog to
Scainner's dongle (ELM-class/PSA-USB hardware) than Diagbox is. Named
brands are still covered in the table (with OBDeleven's non-support noted
as a finding, not an omission).
Risk: low. PSACOM/Stellacan claims are sourced from vendor/reseller pages,
same confidence tier as most other aftermarket-tool claims in this space —
flagged in scope cuts that these weren't independently verified hands-on.

## Not independently re-verifying Launch/Autel's PSA feature tier

What: reported Launch/Autel's PSA capabilities from general industry
knowledge rather than running additional targeted searches to source
specific claims the way the other rows are sourced.
Options: (a) spend another search round chasing citable specifics for
these two brands, (b) report the general-knowledge assessment plainly
labeled as lower-confidence and move on.
Why: (b). These two rows matter less to the roadmap decision than the
PSA-specific tools and Diagbox — Scainner's realistic bar is the PSA
aftermarket tier and the OEM ceiling, not generic multi-brand pro tools.
Time was better spent going deeper on the security-access and BSI-wall
facts (section 2), which change the actual candidate-feature answers.
Risk: low, explicitly logged as a scope cut with a confidence flag rather
than presented as equally solid.

## Recommending PSA-deep-first (approach A) over generic-shallow-first (B)

What: recommended building the first write feature against the specific
car in hand (engine/ABS actuator tests) rather than starting from
brand-agnostic infrastructure with no PSA target yet.
Options: (a) generic-shallow-first — build the safety rail against
whatever routines are standardized across brands, (b) PSA-deep-first —
build the rail generically but aim the first real feature at the verified
reachable modules on this car.
Why: (b), because standardized cross-brand write routines are rare enough
that (a) risks shipping infrastructure with nothing real to exercise it
on, and this repo's own history (DTC-clear, the UDS hunt sessions) shows
the pattern that works here is verify-against-the-real-car-first, then
generalize the plumbing once a second car exists. This is a judgment call
for the planner to confirm, not a fact.
Risk: medium — this is the single most consequential recommendation in
the research and the planner may weigh differently; flagged clearly as a
recommendation, not a decision, in section 6 of research.md.
