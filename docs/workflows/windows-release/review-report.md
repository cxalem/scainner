# Independent review: `ws/windows-ci-build@473a5b5`

Review date: 2026-08-31. Reviewer: Codex, independently cross-examined by a read-only
review agent. Compared with its parent and current `origin/main@c612e1b` at the time
of review.

## Reconciliation status (2026-09-02)

This remains historical evidence about `473a5b5`, not a review of current
implementation. The build remains rejected. Any implementation must follow the
approved plan and be recreated from `origin/main@6a5710e0`.

## Verdict

**Request changes. Do not push or merge the existing commit.** The workflow-only
scope is correct and no application regression was introduced, but release-integrity
and supply-chain gates are unresolved. Recreate the approved plan on current main.

## Findings

### P1: updater manifest behavior is assumed, not proved

Both native jobs mutate one `latest.json` through `tauri-action@v0`. Serialization
avoids a parallel race but does not prove the second upload retains every macOS entry.
The first draft must fail closed unless all platform entries/signatures are present;
otherwise use an explicit finalize design.

### P1: Windows is not checked before release

PR CI is Ubuntu-only. The new job first compiles Windows after a release tag/manual
trigger, turning ordinary compiler or bundler failures into release incidents.
SCAINNER-01's Windows PR CI is a dependency.

### P1: mutable actions receive release authority and signing secrets

`tauri-apps/tauri-action@v0` and other tag references can move. The release job has
`contents: write`; the Tauri step receives the updater private key. Pin reviewed full
SHAs, narrow job permissions and disable persisted checkout credentials.

### P2: manual dispatch can use `main` as the release tag

`workflow_dispatch` has no required tag input, while `tagName` is `github.ref_name`.
The smallest safe v1 is tag-only release triggering.

### P2: release tag and embedded version can disagree

The workflow accepts any `v*`; all three application manifests currently say `0.1.0`.
A secret-free preflight must strip exactly one leading `v`, parse all three versions,
and fail before native jobs on any mismatch.

### P2: repository routing becomes contradictory

The change says Windows bundles are built while two backlogs still defer them. Correct
those statements in a separate documentation PR after the workflow actually lands;
continue to defer Windows serial/Bluetooth.

### P2: unsigned output is presented too broadly

The release body teaches "Run anyway" without distinguishing an internal artifact
from a customer release. Keep it draft/internal, record SHA-256 and require a separate
Authenticode decision before public distribution.

### P2: the implementation branch is stale

It is one commit ahead and seven behind `origin/main`; its base is `c0cee6e`. A manual
run would build an obsolete snapshot. Recreate the one-file implementation on current
main after approval.

## What was verified

- Exact one-file diff and job ordering.
- Current CI triggers, permissions and platform coverage.
- Tauri updater/bundle configuration and application versions.
- Existing Windows transport limitation and release-note wording.
- Current branch ancestry and stale backlog statements.

## What was not verified

No Windows runner, release secrets, draft release, installer, updater manifest,
signature, WebView2 launch, SmartScreen behavior or vehicle interaction was available.
Claude's reported YAML/actionlint checks are provenance, not independent evidence; they
must be rerun on the eventual approved implementation.
