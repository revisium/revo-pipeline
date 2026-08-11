# Repository Structure

`@revisium/revo-pipeline` is in publication-blocked `rp-01` foundation delivery.

```text
architecture/layers.json  canonical layer activation, DAG, and visibility manifest
src/index.ts               inert root module with no runtime exports
src/foundation/            active private portable/schema/canonical/digest primitives
scripts/              local Sonar helpers
test/foundation/      foundation behavior and normative digest-vector suites
test/architecture/    manifest, filesystem, and dependency-rule fixtures
test/docs/            delivery-plan traceability checks
test/package/         publication-block and empty-root-surface tests
docs/specs/           six Draft normative contracts
docs/adr/             accepted direct-cutover decision
docs/conformance/     103-row intent ownership matrix
.github/workflows/    exactly ci.yml with read-only verification behavior
```

`package.json` is private and has no `main`, `types`, `exports`, `files`,
`publishConfig`, or prepack hook. Production dependencies are exactly
`typebox@1.3.10` and `canonicalize@3.0.0`. Its unconditional `prepublishOnly` hook
refuses publication.

## Canonical private layers

Implementation proceeds only through the sequential work items. The intended dependency
direction is:

```text
source -------------> foundation
materialization ----> foundation + source contracts
program ------------> foundation
compiler/linker ----> foundation + source + materialization + program
kernel -------------> foundation + program
extensions/tooling -> source + materialization + compiler (compile time only)
```

`architecture/layers.json` owns this DAG without duplicating it in dependency-cruiser
configuration. At `rp-01`, only `src/foundation/` exists. Vitest pins the current manifest
and filesystem, while dependency-cruiser checks the resolved graph for cycles, root and
deep cross-layer imports, unresolved local imports, DAG violations, Node core drift, and
classified nonproduction dependencies. Its resolved production-package allowlist comes
from `package.json`. Same-layer peer imports remain valid, and the current implementation
uses `node:crypto` for SHA-256.

The package is ESM. TypeScript, oxlint, Vitest, dependency-cruiser, build, and audit are
normal contributor guardrails, not a source-syntax parser or a security sandbox against
coordinated changes to code, configuration, and checks. Workflow changes are reviewed;
the ordinary `rp-01` contract keeps `ci.yml` as the sole workflow.

Every layer remains private. The root authoring/compiler manifest and narrow `./kernel`
machine manifest described by Conformance v1 are final `rp-06` surfaces, not reset
exports. No folder path becomes a public deep import.

Dependency-cruiser derives layer rules from the manifest, enforces no cycles, keeps
resolved local source imports inside `src`, and rejects unresolved source imports.

## Work-item sequence

`rp-00` reset/docs/block → **`rp-01` foundation (active)** → `rp-02`
source/materialization →
`rp-03` compiler/program/digests → `rp-04` base kernel → `rp-05` coordination/waits →
`rp-06` conformance/readiness.

Direct cutover means no compatibility layer or parallel implementation is allowed at
any point. The package remains nonpublishable until the `rp-06` gates and a later
separate publication approval.

See `docs/delivery-plan.md` for objective, scope, out-of-scope, acceptance, dependencies,
and the parseable requirement/group/owner/evidence map for every work item. Structural
tests validate its 62 unique rows, coverage of the 48 specification sections, and active
suite references without duplicating the plan as a second oracle. Planned future evidence
creates no source directories, API exports, or suite placeholders.
