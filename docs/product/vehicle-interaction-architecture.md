# Vehicle interaction architecture

Status: proposed, 2026-08-25. Not built.

This document covers the layer that `diagnostic-intelligence.md` deliberately
leaves abstract: **how Scainner knows what it can say to a given ECU, how it
says it, and how it records what happened.**

`diagnostic-intelligence.md` describes the reasoning product (evidence,
hypotheses, reports). It refers to "knowledge packs" and "coverage" as
concepts without specifying them. This document specifies them, and adds the
three things the product needs before it can do what a mid-tier shop tool
does:

1. A single machine-readable model of every operation the app can perform on
   a vehicle, including operations that write.
2. A record of every interaction with a vehicle, not just the writes.
3. A way to ship new vehicle knowledge without shipping a new binary.

It also fixes the reason clearing codes has never worked (section 7), which is
not an architectural problem but is the most user-visible one and is grounded
in the same missing pieces.

## 1. Why this is needed now

The commercial goal, in the owner's words: match what an iCarsoft-class tool
does for a fraction of its price, with better software around it. That tier's
capability list is not exotic. It is standard diagnostics, per-module fault
access, live enhanced sensors, and a set of service functions (oil reset,
brake service mode, particulate-filter regeneration, adaptation resets).

The protocol work for all of that is ISO 14229 over the same adapter Scainner
already drives. The blockers are not hardware and not transport. They are:

- **Knowledge**: which module, which identifier, which routine, on which car.
- **Authorization**: some operations require a seed/key exchange.
- **Preconditions**: many operations are refused unless the vehicle is in a
  particular state, and Scainner currently checks none.
- **Distribution**: knowledge changes constantly and cannot ride app releases.

Today each of these is either absent or hardcoded. Section 2 is the current
state, verified against the code rather than assumed.

## 2. Current state, verified

Verified against `main` at commit `9247251` on 2026-08-25.

**Vehicle knowledge is split across four incompatible places:**

| Where | What | Updatable without a rebuild? |
|---|---|---|
| `packages/uds-map/data/uds-map.json` | 21 brands, 251 WMI prefixes, 180 modules, 181 known DIDs | No. `include_str!` at `uds_map.rs`, compiled into the binary |
| `uds_modules` SQLite table | User-added CAN request/response IDs | Yes, but per install and unshared |
| `apps/desktop/src/lib/dtc.ts` | DTC descriptions | No, TypeScript source |
| `apps/desktop/src/lib/brand.ts` | WMI to brand table | No, TypeScript source |

`packages/uds-map/RESEARCH.md` additionally holds real safety knowledge as
prose: which brands gate which identifiers behind security access, which
brands use component protection, which gateways block writes. None of it is
machine-readable, so the engine cannot act on any of it.

**Implemented UDS services** (exhaustive):

| Service | Status |
|---|---|
| `0x10` DiagnosticSessionControl | Implemented; this branch recognizes positive `50 03` acknowledgement and otherwise stays in default session |
| `0x22` ReadDataByIdentifier | Implemented, the core primitive |
| `0x19` ReadDTCInformation | Implemented, subfunction `0x02`, mask `0xAF` only |
| `0x14` ClearDiagnosticInformation | Implemented, group `FFFFFF` (see section 7) |
| `0x3E` TesterPresent | Implemented, used during scans, **not during clears** |
| `0x27` SecurityAccess | Absent |
| `0x2E` WriteDataByIdentifier | Absent |
| `0x31` RoutineControl | Absent |
| `0x2F` InputOutputControlByIdentifier | Absent |
| `0x11` ECUReset, `0x85` ControlDTCSetting | Absent |

Plus OBD-II mode `04` (generic clear) in `obd.rs`.

**There is no negative-response handling anywhere.** The NRC byte is parsed off
the wire and discarded. `0x33` securityAccessDenied, `0x22` conditionsNotCorrect,
`0x31` requestOutOfRange, and `0x78` responsePending are all indistinguishable
from each other and from success.

**ELM327 error strings are not recognised as errors.** `parser::clean_response`
filters only `SEARCHING...`. `NO DATA`, `BUS ERROR`, `CAN ERROR`,
`UNABLE TO CONNECT`, `STOPPED`, and `?` produce zero parseable hex bytes and
silently degrade to an empty payload, which callers read as "no data present"
rather than "the request failed".

**What exists and is good**, and should be extended rather than replaced:

- `writes_log` — a real audit table with before/after state, outcome, and a
  `confirmed: bool` enforced at the Tauri command boundary. The safety rail
  from the `write-caps` stream (confirmation modal, required reversal text,
  logged before/after) is sound and is the right pattern for every future
  write.
- `discovered_modules` / `discovered_dids` with a `confidence` enum
  (`confirmed` / `ai_guess` / `unlabeled`) — the learning loop's storage
  already exists.
- `uds_probes.origin` (`manual` / `discovery`) — provenance already tracked.
- Scan safety: cooperative cancellation, link-degradation backoff, and
  engine-start voltage detection that aborts a scan mid-pass.
- The Supabase mirror with RLS keyed on `private_can_see_vehicle`.

## 3. Three data planes

The single most important structural decision. Today knowledge, operational
data, and unconfirmed observations are mixed together, which is why knowledge
cannot ship independently and observations cannot be shared safely.

### Plane 1 — Knowledge: what cars are like

Versioned, identical across every install, read-mostly, not customer data.
Brand, platform, module, identifier, routine, DTC meaning, precondition,
risk. `uds-map.json` is the seed of this plane.

- **Bundled with the app** so a first run with no network is fully functional.
- **Updated over the network independently of app releases** (section 6).
- **Signed and privilege-bounded.** Signature verification authenticates a
  pack, but does not make every signed operation safe. The binary enforces a
  service allowlist and a maximum privilege tier independently of pack data;
  read-only knowledge and authorized operations use separate signing roots.

### Plane 2 — Operational: what happened to this vehicle

Per-vehicle, per-install, customer data, tenant-isolated. Already exists and
already mirrors to Supabase under RLS: `vehicles`, `connections`, `readings`,
`dtc_scan_events`, `dtc_codes`, `writes_log`, `discovered_*`.

### Plane 3 — Observations: what we learned that is not knowledge yet

The learning loop. Unknown identifiers with raw samples, candidate labels,
and per-(brand, module, service) outcome statistics.

- Collected locally always.
- Contributed upstream **only with explicit consent**, and **never with the
  VIN** — a VIN identifies a vehicle and its owner. Contributions carry only
  an allowlisted WMI, model year, module address, DID, payload shape, and
  redacted samples. Raw ECU identity blocks are prohibited because standard
  identity DIDs may contain a VIN, ECU serial number, or other stable ID.
- **Promoted into Plane 1 by review, never automatically.** An AI-proposed
  label is a candidate. Cross-vehicle agreement raises its confidence. Neither
  makes it trusted knowledge.

### This answers the local-versus-Supabase question

The question was whether the authorization and procedure data should live
locally or in Supabase. The answer is both, with a strict split of roles:

- **Knowledge is resolved locally, always.** A mechanic in a basement workshop
  with no signal must get full capability. A scan must never block on a
  network round trip; the operations in question have sub-second protocol
  timing constraints.
- **Supabase is the distribution and contribution channel**, not the runtime
  lookup. It serves signed pack versions and receives consented observations.

Scainner never queries Supabase during a scan.

## 4. The capability model

The core abstraction, and the piece that makes "do what the paid tools do"
tractable rather than an endless pile of per-brand special cases.

Every operation Scainner can perform on a vehicle becomes one declarative
entry:

```
capability
  id                     stable identifier, e.g. "psa.engine.clear_faults"
  kind                   session | read_did | read_dtc | clear_dtc
                         | routine | write_did | io_control
  applicability          brand, platform, year range, ECU identity match,
                         powertrain — the matching rules, not a bare DID
  request                service, subfunction, parameters
  preconditions          ignition state, engine state, vehicle stationary,
                         minimum voltage, required session, required
                         TesterPresent keepalive
  authorization          none | security_access { level, algorithm_ref }
  expected_response      positive service byte and payload shape
  known_nrcs             NRC to plain-language meaning, in this context
  risk                   read_only | reversible | irreversible | disruptive
  reversal               how to undo it, or an explicit statement that it
                         cannot be undone and why shipping it is still safe
  settle_ms              how long to wait before verifying
  confidence             confirmed | high | medium | low
  provenance             where this entry came from
```

Consequences of modelling it this way:

- **Today's clear becomes a capability**, with the preconditions the current
  code does not check (section 7) expressed as data rather than forgotten.
- **Service functions are not a new subsystem.** An oil-service reset is a
  `routine` capability. The engine that executes capabilities executes all of
  them; only the data differs. This is what turns "match iCarsoft" from a
  rewrite into a data-population exercise.
- **The safety rail becomes automatic.** `risk` and `reversal` are exactly
  the fields the existing `ConfirmWrite` modal already requires a human to
  write by hand. Anything not `read_only` routes through the existing rail
  with no per-feature UI work.
- **Coverage becomes computable.** "What can this app do to this exact car"
  is a query over applicability, which is what the coverage reporting in
  `diagnostic-intelligence.md` needs and cannot currently answer.
- **The map's existing per-entry `confidence` finally gets consumed.** It is
  shipped today on brands, modules, and DIDs, and read only for bands.

## 5. Authorization: security access as data plus registered algorithms

Some operations require a seed/key exchange (`0x27`): the tester requests a
seed, transforms it, and returns the key. Independent repair depends on this
working, and for many mainstream brands the transforms are published in
open-source projects. `write-caps/research.md` already identified PSA's as
publicly documented.

**The design rule: algorithms are compiled-in code, referenced by id. Packs
select an algorithm, they never define one.**

```
authorization: {
  kind: "security_access",
  level: 0x01,
  algorithm_ref: "psa_sk_v1",
  params: { ... ECU-specific constants ... }
}
```

The reason is a genuine security boundary, not ceremony. If a pack could
carry an executable transform, a compromised pack could introduce arbitrary
code. A compiled registry removes that capability, but a malicious pack could
still invoke a real algorithm against the wrong module. The binary must also
bind every algorithm id to allowed brands, address families, security levels,
services, and operation tiers. Adding or widening an algorithm remains a code
change and release, deliberately.

**Scope boundaries, decided:**

| Category | Position |
|---|---|
| Service and maintenance functions: oil/service reset, brake service mode, particulate-filter regeneration, throttle and idle relearn, battery registration, adaptation resets | **In scope.** This is the target tier. Routine independent-repair work. |
| Reading anything, including security-gated reads | **In scope.** |
| Immobilizer and key programming | **Explicitly out.** Not a technical judgement. This is the one category with a direct theft-enablement path, and legitimate tools that offer it gate it behind verified locksmith or shop identity. It needs a separate decision with legal review and a customer-verification mechanism, and must not be arrived at by drift. |
| ECU flashing and reprogramming | **Out.** Timing-sensitive, needs a clock-accurate interface; a generic adapter dropping frames mid-flash bricks the module. Documented hardware wall in `write-caps/research.md`. |
| Anything whose reversal path is unknown | **Out**, by the existing hard rule. |

**Sequencing.** No write beyond DTC clear ships in alpha (section 8). The
capability model is built in alpha because it is also what makes reads and
clears correct; the authorization field is designed in alpha and populated
after. Building the authorization machinery is a beta activity; the reason to
design it now is that retrofitting authorization into an already-shipped
capability model is a schema migration across every entry.

**Research to run before populating any of this** (not now, per the owner's
own sequencing): catalogue which seed/key algorithms and service-routine
identifiers are genuinely public per brand, with a real source per entry, and
record the source in `provenance`. An entry whose origin cannot be named does
not go in the pack.

## 6. Distribution: packs that ship without a binary

The hard constraint today: `include_str!` means a corrected module address, a
new brand, or a new safety flag requires a full Rust rebuild and an app
release. Every learning the product accumulates is trapped behind a release
cycle. The learning loop is worthless under that constraint.

Target model:

- The app ships with a **bundled baseline pack** (today's `uds-map.json`
  content plus the capability fields). First run works offline, fully.
- At runtime the app resolves knowledge from **the highest-version valid pack
  available**: bundled, or a downloaded one in the app data directory.
- Packs are **downloaded to staging, schema-validated, signature-verified,
  then atomically activated**. A pack that fails any step is discarded, and
  the previous pack keeps working. Activation rejects version rollback unless
  a signed revocation manifest explicitly authorizes it; signing keys support
  rotation and emergency revocation.
- Packs are **versioned and pinned per scan**. A report says which pack
  version produced its interpretations. This matters for reproducibility: a
  report regenerated later against a newer pack can legitimately reach a
  different conclusion, and that must be visible rather than silent.
- **Rollback is supported.** A bad pack is a product incident affecting every
  install; reverting to the previous version must not require an app release.

The existing `@scainner/uds-map` npm package remains the public,
open-source view of the read-only knowledge. The capability layer, including
anything authorization-related, is not part of that package.

Keep the schema-version field meaningful: the app must refuse a pack whose
schema version it does not understand, rather than silently ignoring fields
it cannot parse. The current Rust structs drop `confidence` on brands,
modules, and DIDs through serde's default permissive behaviour, which is
exactly the failure mode to design out.

## 7. The operations ledger, and why clearing codes never worked

### 7.1 Generalize `writes_log` into `operations`

`writes_log` records only writes, and records no raw protocol bytes. That
second omission is why the bug below survived for months: the audit trail
recorded the verdict `refused` without recording what the module actually
said.

Every interaction with a vehicle, read or write, becomes one row:

```
operations
  id, cloud_id
  vehicle_id, connection_id
  ts, duration_ms
  capability_id            null for ad-hoc Lab requests
  module                   request and response addresses, not a label
  request_hex              what was sent
  response_hex             what came back, verbatim, including error strings
  outcome                  ok | negative_response | no_response
                           | refused_precondition | transport_error
  nrc                      the negative response code, when there was one
  before_json, after_json  for writes, as writes_log has today
  confirmed_by             for writes
  pack_version             which knowledge produced this request
```

This one table serves four purposes at once: the audit trail, the debugging
record, the learning corpus for plane 3, and the evidence a report cites.
`writes_log` becomes a view over it, so the existing Write history UI keeps
working.

Volume needs a retention policy from the start: full raw capture for writes
and failures indefinitely, and a bounded window for high-frequency successful
reads.

### 7.2 Why clearing codes has never worked

Three defects, all confirmed by reading `main` and reproduced by executable
test, not inferred.

**Defect 1: the UDS clear path cannot report success. Ever.**

The positive response to `14FFFFFF` is a single byte, `0x54`. With headers
off, the adapter prints one line: `54`.

`parser.rs` `payload_bytes` discards a first line that decodes to exactly one
byte and contains no colon, because that is the shape of an ISO-TP length
prefix:

```rust
if !started {
    // first-frame length line of an ISO-TP reply is just "014" — skip pure length lines
    if bytes.len() == 1 && !line.contains(':') {
        continue;
    }
    started = true;
}
```

`uds.rs` then asks:

```rust
Ok(payload.first() == Some(&0x54))
```

The payload is empty, so this is `false`. Reproduced directly:

```
payload_bytes(["54"])            = []                  -> clear_dtcs returns false
payload_bytes(["7F 14 78","54"]) = [7F, 14, 78, 54]    -> clear_dtcs returns false
```

The second case is the `0x78` responsePending sequence, which is common
because `0x14` is slow. It fails for a different reason: the check reads
`first()` rather than looking for the positive byte after skipping pending
frames.

Both real-world positive outcomes report failure. The user is then shown
"The module refused the clear command. Nothing was changed." on a clear that
in all likelihood succeeded.

**Defect 2: the OBD mode 04 path performs no verification at all.**

```rust
if let Err(e) = drv.cmd("04", Duration::from_secs(10)) { ... }
```

The response string is discarded. `cmd` returns `Err` only on a transport
failure or a completely empty buffer, and the adapter always echoes at least
a prompt. So `7F 04 22` conditionsNotCorrect, `NO DATA`, `BUS ERROR`, and
`?` are all indistinguishable from a successful clear.

The only signal is the after-scan still showing codes, and the interface then
blames the vehicle:

> "Cleared, but N codes came straight back. Those are active faults, not
> leftovers, and worth investigating."

That sentence is shown for a clear the ECU flatly refused.

**Defect 3: preconditions are not checked, and the likely real reply is a refusal.**

Many ECUs refuse `04` and `0x14` with `0x22` conditionsNotCorrect while the
engine is running. Scainner's normal state is a live poll loop on a running
car. Nothing checks ignition or engine state, and nothing tells the user to
turn the engine off.

Contributing factors in the same area:

- **No settle delay.** Both paths re-read immediately. ECUs commonly need
  roughly half a second to two seconds after erasing fault memory, during
  which they answer nothing, producing a bogus "verification failed" or
  "faults remain".
- **No TesterPresent during the clear.** The extended session is opened, then
  a six-second before-read runs against a five-second session timer, so the
  session can lapse before the clear is sent.
- **On `main`, the extended-session response was ignored.** This branch now
  requires the positive `50 03` acknowledgement before tracking the session
  as open, but the clear workflow still needs the parser and timing fixes
  above before it can be trusted.
- **`ATSP6` is never undone by teardown.** One visit to the Lab pins the
  adapter to 11-bit CAN 500k for the rest of the connection. On a non-CAN
  vehicle, and the repo documents a live K-line Peugeot, everything
  afterwards fails.
- **Permanent codes cannot be cleared by mode 04 at all**, by design. They are
  correctly excluded from the verdict but still displayed, so a genuinely
  successful clear can still look like it left codes behind.

### 7.3 The fix

1. Stop swallowing single-byte payloads. The length-prefix heuristic must be
   scoped to genuine multi-frame replies rather than applied to any one-byte
   first line, with the UDS clear response as a regression test.
2. Parse negative responses properly, everywhere. A shared decoder returning
   the service, whether it was positive or negative, and the NRC. Skip `0x78`
   pending frames and wait for the real answer.
3. Recognise adapter error strings as errors rather than as empty payloads.
4. Verify mode 04's response instead of discarding it.
5. Check preconditions before writing, and say which one failed. If the ECU
   wants the engine off, ask for the engine off rather than sending a request
   that will be refused.
6. Add a settle delay before verification, and keep the session alive with
   TesterPresent across the clear.
7. Restore the protocol setting in teardown.
8. Record the raw request and response bytes for every clear, so the next bug
   of this shape is visible in the audit trail rather than invisible for
   months.
9. Report honestly: cleared, refused with a decoded reason, or partially
   cleared with permanent codes explained.

This is the alpha's first work item. It is table stakes, it is currently
broken on every car, and the same missing pieces (negative-response decoding,
preconditions, raw capture) are prerequisites for every service function
that would follow.

## 8. Alpha definition

Alpha is a high-fidelity build that a real mechanic can use on a real
unfamiliar car. It is defined by honesty and reliability, not by breadth of
brand coverage.

**In alpha:**

1. **Connects to any OBD-II vehicle** and identifies it honestly, including
   vehicles whose VIN cannot be read, which the Peugeot proved is real.
2. **Standard diagnostics that work on any brand**: faults with real
   descriptions, freeze frames, readiness, live sensors, recorded history.
3. **Clearing codes actually works**, and when it does not, it says which
   precondition failed or what the module answered.
4. **Enhanced discovery for mapped brands**, with coverage stated honestly:
   which modules were expected, reached, refused, and timed out. An
   engine-only scan is never presented as a whole-vehicle scan.
5. **Evidence-backed reports**, persisted and versioned, in two registers
   (technical and customer-facing), exportable, in English and Spanish.
6. **Every interaction recorded** in the operations ledger.
7. **Knowledge packs update without an app release.**

**Not in alpha**, deliberately:

- Any write beyond DTC clear. No routines, no adaptations, no coding.
- Security access. Designed for, not populated.
- Mobile. Fleet. Multi-tenant accounts beyond what already exists.

**The alpha test that matters** is not a checklist: connect to a car nobody
on the project has ever seen, and have the app produce a report a mechanic
would act on, with coverage stated honestly enough that they trust what it
did not find as much as what it did.

## 9. Work streams

Following the repo's existing convention: one stream, one agent, one file
boundary. Ordered by dependency, not by importance.

**N. Clear-codes correctness and the negative-response layer.**
Section 7.3. Files: `elm/{parser,obd,uds,supervisor}.rs`, the clear-related
i18n strings, `ModuleFaults.tsx`, `ScanConsole.tsx`. First, because it is
broken on every car today and everything else in the write direction depends
on the negative-response decoder it introduces. Ships with unit tests for
each response shape, including the two proven failures above.

**O. Operations ledger.**
Section 7.1. `operations` table, `writes_log` as a view, raw capture at the
driver boundary, retention policy, Supabase mirror and RLS. Depends on N for
the decoded outcome shape.

**P. Capability model and pack schema.**
Section 4. Schema definition, migration of `uds-map.json` into it without
losing the existing 181 known DIDs, a single executor in Rust that runs a
capability, and coverage as a query over applicability. Rust and TypeScript
must derive from one schema rather than being hand-synced, since that drift
is already live.

**Q. Pack distribution.**
Section 6. Runtime load with bundled fallback, signature verification,
version pinning per scan, rollback. Depends on P.

**R. Reports.**
Persisted and versioned reports replacing today's localStorage markdown,
evidence links into `operations` and fault observations, technical and
customer registers, export, English and Spanish. Depends on O for evidence
links.

**S. Learning loop.**
Plane 3. Candidate labels from correlation against known values, cross-vehicle
agreement raising confidence, consented and VIN-free contribution, review
before promotion into a pack. Depends on O and Q.

**T. Authorization machinery.** Post-alpha, per section 5. Algorithm registry,
`0x27` exchange, capability authorization field populated. Gated on the public
seed-key and routine research being done with a real source per entry.

**U. Service functions.** Post-alpha. The first routine capabilities behind the
existing safety rail, each with a verified reversal path. Gated on T and on
the routine-identifier hunt that `write-caps` increment 2 already scoped.

## 10. Open questions

- **Retention.** How long full raw capture is kept for successful reads before
  it is thinned. Needs a real measurement of row volume from a working day.
- **Pack signing key custody.** Where the private key lives and who can
  publish. A pack is remote code execution against a customer's vehicle in
  every sense that matters.
- **Contribution consent UX.** Whether contribution is opt-in or opt-out, and
  how a shop's customers are represented in that choice, given the data
  concerns a third party's vehicle.
- **Pack licensing.** The read-only map is open source today. Whether the
  capability layer stays open is a live commercial question, unresolved, and
  connected to the repo-visibility question already open in the vault plan.
- **Non-CAN transports.** K-line vehicles work for standard OBD today but have
  no enhanced path. Whether that tier is worth supporting is a coverage
  decision, not an architectural one, but the capability model should not
  assume CAN.
