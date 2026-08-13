# Delivery plan

This plan turns Accepted ADR 0005 and the six Draft specifications into sequential
`rp-00` through `rp-06` work items. It does not accept a Draft specification, create a
future implementation placeholder, expose a package API, or authorize publication.
This plan owns the delivery schedule. `architecture/layers.json` remains the
machine-readable source for current layer state, dependency direction, and
private/public visibility.

## `rp-00` — reset and publication block

- **Objective:** establish the direct-cutover repository and remove every competing
  implementation or compatibility surface.
- **Scope:** inert root, Accepted ADR 0005, six Draft specs, architecture and ownership
  documents, verification baseline, and unconditional publication refusal.
- **Out of scope:** production behavior, production dependencies, public exports,
  adapters, converters, release workflows, and consumer integration.
- **Acceptance:** the private package has no runtime exports, release workflow, or
  production behavior and preserves the exact 12/9/103 baseline counts.
- **Dependencies:** none.

## `rp-01` — foundation

- **Objective:** implement bounded, deterministic, value-redacted primitives for every
  later layer.
- **Scope:** portable JSON, Unicode, identifiers, RFC 6901, bounds, closed diagnostics,
  closed TypeBox helpers, RFC 8785 bytes, exact digest domains, architecture enforcement,
  and exact production dependencies.
- **Out of scope:** source or Program schemas, materialization, compiler semantics,
  kernel behavior, public digest wrappers, future layer directories, and package exports.
- **Acceptance:** focused foundation, hostile-input, golden-vector, architecture,
  publication, and full repository gates pass while only foundation is active.
- **Dependencies:** `rp-00`.

## `rp-02` — source and materialization

- **Objective:** implement the complete closed authoring language and portable profile
  contribution without exposing them publicly.
- **Scope:** 12 source kinds, recursive regions, selectors, ValueSchema, source
  validation, local region graph semantics, finite `otherwise: null` choice proof,
  canonical agent-slot paths and source digests, the exact materialization envelope,
  source-relative slot validation, materialization digests, and keyed-set normalization.
- **Out of scope:** Program emission, compiler-bundle digests, runtime execution, exact
  executor bindings, host policy, and public exports.
- **Acceptance:** runtime/static schema agreement, all 12 kinds, closed tagged unions,
  local/nested CFG checks, selector contexts, finite choice coverage, hostile-object and
  boundary handling, canonical-path/digest vectors, materialization totality/policy,
  deterministic diagnostics, and normalization suites pass.
- **Dependencies:** `rp-01`.

## `rp-03` — compiler and Program

- **Objective:** deterministically validate, link, lower, and hash one closed compiler
  bundle.
- **Scope:** nine-kind Program IR, linking, reachability, dominance, schema compatibility,
  bounds, requirements, provenance, synthesized IDs, and compiler artifact digests.
- **Out of scope:** machine state, commands, host binding resolution, DBOS, retry/time
  policy, and public exports.
- **Acceptance:** every source kind lowers into exact IR, failures produce no partial
  output, and complete compiler-bundle semantic and digest suites pass.
- **Dependencies:** `rp-02`.

## `rp-04` — base kernel

- **Objective:** execute admitted base Program structure as a pure command-producing
  transition system.
- **Scope:** base state/frame/result/event/command envelopes, structural identities,
  initialization, activity, choice, call, end, replay, faults, and base cancellation.
- **Out of scope:** structured coordination, repeat, map, waits, gates, durability,
  attempts, timers, authorization, persistence, and public exports.
- **Acceptance:** base transition, identity, canonical state/event, replay, purity,
  terminal, and command-order suites pass.
- **Dependencies:** `rp-03`.

## `rp-05` — coordination, waits, and gates

- **Objective:** complete bounded structured execution while preserving the pure
  kernel/host boundary.
- **Scope:** parallel and vote policies, drain/cancel, repeat, map, waits, gates,
  cancellation targets, acknowledgements, declared signal/gate-answer validation by
  pending operation ref, shared Program admission, and fixed Machine resource bounds.
- **Out of scope:** host timers, DBOS, global capacity, authorization, run IDs, attempts,
  subscriptions, release workflows, and public exports.
- **Acceptance:** exhaustive structured-machine, canonical coordination, cancellation,
  restart-serialization, and no-detached-work suites pass.
- **Dependencies:** `rp-04`.

## `rp-06` — conformance and readiness

- **Objective:** prove the direct cutover and introduce only the exact final manifests
  after a separate human acceptance gate.
- **Scope:** 103/103 traceability, remaining normative evidence, exact root and kernel
  manifests, packed consumer checks, and acceptance of the six specs.
- **Out of scope:** compatibility behavior, `planDigest`, host policy, persistence,
  release publication, tagging, deployment, and automatic migration.
- **Acceptance:** counts remain 22/32/7/42 and 54/49, all package/consumer/provider/review
  gates are green on one head, and humans separately approve acceptance and any release.
- **Dependencies:** `rp-05` plus approved core/run consumer-readiness evidence.

## Parseable specification traceability

Each row is one independently verifiable requirement. `group` is the specification
workstream and `owner` is the repository layer or repository policy boundary responsible
for the evidence. `evidence_state` is `active` only for implemented `rp-00` through
`rp-05` evidence and `planned` for future work. Repeated spec sections deliberately split
foundation byte/domain evidence from compiler, base-kernel, and coordination semantics;
planned rows reserve evidence ownership only and create no directories, APIs, or test
placeholders.

```json
[
  {
    "requirement_id": "req-001",
    "spec": "pipeline-canonicalization-v1",
    "section": "Scope",
    "group": "lifecycle",
    "owner": "repository",
    "item": "rp-00",
    "suite": "test/package/publication-block.test.ts#publication block",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-002",
    "spec": "pipeline-canonicalization-v1",
    "section": "Scope",
    "group": "lifecycle",
    "owner": "extensions",
    "item": "rp-06",
    "suite": "canonicalization-public-readiness",
    "evidence_state": "planned"
  },
  {
    "requirement_id": "req-003",
    "spec": "pipeline-canonicalization-v1",
    "section": "Validated canonical domain",
    "group": "canonicalization",
    "owner": "foundation",
    "item": "rp-01",
    "suite": "test/foundation/portable-value.test.ts#portable JSON values",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-004",
    "spec": "pipeline-canonicalization-v1",
    "section": "Validated canonical domain",
    "group": "canonicalization",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/program/contracts/envelope.test.ts#survives a JSON round trip and rejects unknown envelope fields",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-005",
    "spec": "pipeline-canonicalization-v1",
    "section": "Validated canonical domain",
    "group": "canonicalization",
    "owner": "kernel",
    "item": "rp-04",
    "suite": "test/kernel/contracts.test.ts#PipelineStateSchema",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-006",
    "spec": "pipeline-canonicalization-v1",
    "section": "Validated canonical domain",
    "group": "canonicalization",
    "owner": "kernel",
    "item": "rp-05",
    "suite": "test/kernel/structured-canonicalization.test.ts#validates the structured canonical domain with a closed negative matrix",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-007",
    "spec": "pipeline-canonicalization-v1",
    "section": "Serialization and hash preimage",
    "group": "canonicalization",
    "owner": "foundation",
    "item": "rp-01",
    "suite": "test/foundation/canonicalization.test.ts#validated RFC 8785 canonicalization",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-008",
    "spec": "pipeline-canonicalization-v1",
    "section": "Fixed domains and payloads",
    "group": "canonicalization",
    "owner": "foundation",
    "item": "rp-01",
    "suite": "test/foundation/digest.test.ts#pins the exact seven domains",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-009",
    "spec": "pipeline-canonicalization-v1",
    "section": "Fixed domains and payloads",
    "group": "canonicalization",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/emission/bundle.test.ts#pins the full compiler bundle digest",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-010",
    "spec": "pipeline-canonicalization-v1",
    "section": "Fixed domains and payloads",
    "group": "canonicalization",
    "owner": "kernel",
    "item": "rp-04",
    "suite": "test/kernel/identity.test.ts#covers base structural payload domains with pinned digests",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-011",
    "spec": "pipeline-canonicalization-v1",
    "section": "Fixed domains and payloads",
    "group": "canonicalization",
    "owner": "kernel",
    "item": "rp-05",
    "suite": "test/kernel/identity.test.ts#pins all eight command key vectors across seven kinds and both wait variants",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-012",
    "spec": "pipeline-canonicalization-v1",
    "section": "Required golden vectors",
    "group": "canonicalization",
    "owner": "foundation",
    "item": "rp-01",
    "suite": "test/foundation/digest.test.ts#matches the normative synthesized direct IR ID vector",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-013",
    "spec": "pipeline-canonicalization-v1",
    "section": "Required golden vectors",
    "group": "canonicalization",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/lowering/id-vectors.test.ts#compiler lowering digest and full-ID vectors",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-014",
    "spec": "pipeline-canonicalization-v1",
    "section": "Required golden vectors",
    "group": "canonicalization",
    "owner": "kernel",
    "item": "rp-04",
    "suite": "test/kernel/identity.test.ts#pins the normative root frame and dispatch command vectors",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-015",
    "spec": "pipeline-canonicalization-v1",
    "section": "Required golden vectors",
    "group": "canonicalization",
    "owner": "kernel",
    "item": "rp-05",
    "suite": "test/kernel/identity.test.ts#pins all eleven normalized event digest vectors across terminal contexts",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-016",
    "spec": "pipeline-canonicalization-v1",
    "section": "Required edge coverage",
    "group": "canonicalization",
    "owner": "foundation",
    "item": "rp-01",
    "suite": "test/foundation/canonicalization.test.ts#pins the representative canonical round trip",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-017",
    "spec": "pipeline-canonicalization-v1",
    "section": "Required edge coverage",
    "group": "canonicalization",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/emission/bundle.test.ts#deterministic across equivalent caller property order",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-018",
    "spec": "pipeline-canonicalization-v1",
    "section": "Required edge coverage",
    "group": "canonicalization",
    "owner": "kernel",
    "item": "rp-04",
    "suite": "test/kernel/replay-and-faults.test.ts#checks the program digest before event normalization",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-019",
    "spec": "pipeline-canonicalization-v1",
    "section": "Required edge coverage",
    "group": "canonicalization",
    "owner": "kernel",
    "item": "rp-05",
    "suite": "test/kernel/structured-canonicalization.test.ts#covers structured canonicalization context and rejection edges",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-020",
    "spec": "pipeline-conformance-v1",
    "section": "Scope and lifecycle",
    "group": "lifecycle",
    "owner": "repository",
    "item": "rp-00",
    "suite": "test/package/publication-block.test.ts#fails closed when invoked as the publish hook",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-021",
    "spec": "pipeline-conformance-v1",
    "section": "Scope and lifecycle",
    "group": "lifecycle",
    "owner": "extensions",
    "item": "rp-06",
    "suite": "conformance-acceptance-lifecycle",
    "evidence_state": "planned"
  },
  {
    "requirement_id": "req-022",
    "spec": "pipeline-conformance-v1",
    "section": "Exact package manifest at `rp-06` acceptance",
    "group": "conformance",
    "owner": "extensions",
    "item": "rp-06",
    "suite": "conformance-package-manifests",
    "evidence_state": "planned"
  },
  {
    "requirement_id": "req-023",
    "spec": "pipeline-conformance-v1",
    "section": "Exact dependency contract",
    "group": "conformance",
    "owner": "foundation",
    "item": "rp-01",
    "suite": "test/package/publication-block.test.ts#validates the blocked package manifest",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-024",
    "spec": "pipeline-conformance-v1",
    "section": "Schema and compiler suites",
    "group": "conformance",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/compile/source-forms.test.ts#compiler source-form coverage",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-025",
    "spec": "pipeline-conformance-v1",
    "section": "Machine suites",
    "group": "conformance",
    "owner": "kernel",
    "item": "rp-05",
    "suite": "test/kernel/structured-machine.test.ts#saturates synchronous structured owners and empty maps to global quiescence",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-026",
    "spec": "pipeline-conformance-v1",
    "section": "Purity, side-channel, and package evidence",
    "group": "conformance",
    "owner": "extensions",
    "item": "rp-06",
    "suite": "conformance-purity-package",
    "evidence_state": "planned"
  },
  {
    "requirement_id": "req-027",
    "spec": "pipeline-conformance-v1",
    "section": "`revo-run` intent traceability",
    "group": "conformance",
    "owner": "extensions",
    "item": "rp-06",
    "suite": "conformance-intent-registry",
    "evidence_state": "planned"
  },
  {
    "requirement_id": "req-028",
    "spec": "pipeline-conformance-v1",
    "section": "Cutover gates",
    "group": "conformance",
    "owner": "extensions",
    "item": "rp-06",
    "suite": "conformance-cutover-gates",
    "evidence_state": "planned"
  },
  {
    "requirement_id": "req-029",
    "spec": "pipeline-machine-v1",
    "section": "Scope and exact functions",
    "group": "machine",
    "owner": "kernel",
    "item": "rp-05",
    "suite": "test/kernel/final-api.test.ts#exposes the final private initialization and advancement API",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-030",
    "spec": "pipeline-machine-v1",
    "section": "Structural frame identities and command references",
    "group": "machine",
    "owner": "kernel",
    "item": "rp-04",
    "suite": "test/kernel/identity.test.ts#kernel structural identities",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-031",
    "spec": "pipeline-machine-v1",
    "section": "Exact terminal results and state envelope",
    "group": "machine",
    "owner": "kernel",
    "item": "rp-04",
    "suite": "test/kernel/contracts.test.ts#keeps every Machine envelope closed and JSON portable",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-032",
    "spec": "pipeline-machine-v1",
    "section": "Exact event union",
    "group": "machine",
    "owner": "kernel",
    "item": "rp-04",
    "suite": "test/kernel/replay-and-faults.test.ts#kernel replay and fault precedence",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-033",
    "spec": "pipeline-machine-v1",
    "section": "Exact command union and order",
    "group": "machine",
    "owner": "kernel",
    "item": "rp-04",
    "suite": "test/kernel/identity.test.ts#orders cancellation, dispatch, and terminal commands by priority",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-034",
    "spec": "pipeline-machine-v1",
    "section": "Initialization, data, frames, and advancement",
    "group": "machine",
    "owner": "kernel",
    "item": "rp-04",
    "suite": "test/kernel/base-advancement.test.ts#kernel base advancement",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-035",
    "spec": "pipeline-machine-v1",
    "section": "Concurrent cancellation and acknowledgement",
    "group": "machine",
    "owner": "kernel",
    "item": "rp-05",
    "suite": "test/kernel/structured-cancellation.test.ts#emits one sorted run intent and waits for every acknowledgement",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-036",
    "spec": "pipeline-machine-v1",
    "section": "Stable fault families",
    "group": "machine",
    "owner": "kernel",
    "item": "rp-04",
    "suite": "test/kernel/fault-contract.test.ts#kernel fault contract",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-037",
    "spec": "pipeline-machine-v1",
    "section": "Host boundary",
    "group": "machine",
    "owner": "kernel",
    "item": "rp-06",
    "suite": "kernel-host-boundary",
    "evidence_state": "planned"
  },
  {
    "requirement_id": "req-038",
    "spec": "pipeline-materialization-v1",
    "section": "Scope",
    "group": "materialization",
    "owner": "materialization",
    "item": "rp-02",
    "suite": "test/materialization/contract.test.ts#materialization contract",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-039",
    "spec": "pipeline-materialization-v1",
    "section": "Exact envelope",
    "group": "materialization",
    "owner": "materialization",
    "item": "rp-02",
    "suite": "test/materialization/contract.test.ts#materialization schema",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-040",
    "spec": "pipeline-materialization-v1",
    "section": "Source-envelope validation",
    "group": "materialization",
    "owner": "materialization",
    "item": "rp-02",
    "suite": "test/materialization/source-coverage.test.ts#materialization source validation",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-041",
    "spec": "pipeline-materialization-v1",
    "section": "Exact lowering",
    "group": "materialization",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/lowering/consensus-topology.test.ts#complete slot-consensus topology and exact materialization paths",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-042",
    "spec": "pipeline-materialization-v1",
    "section": "Determinism and ownership",
    "group": "materialization",
    "owner": "materialization",
    "item": "rp-02",
    "suite": "test/materialization/determinism.test.ts#materialization determinism",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-043",
    "spec": "pipeline-program-v1",
    "section": "Scope",
    "group": "program",
    "owner": "program",
    "item": "rp-03",
    "suite": "test/program/contracts/envelope.test.ts#Program compiler-bundle contracts",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-044",
    "spec": "pipeline-program-v1",
    "section": "Compiler result",
    "group": "program",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/compile/result-contract.test.ts#closed compiler result contract",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-045",
    "spec": "pipeline-program-v1",
    "section": "Program envelope and regions",
    "group": "program",
    "owner": "program",
    "item": "rp-03",
    "suite": "test/program/contracts/envelope.test.ts#accepts the closed Program",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-046",
    "spec": "pipeline-program-v1",
    "section": "Program selectors",
    "group": "program",
    "owner": "program",
    "item": "rp-03",
    "suite": "test/program/contracts/selectors.test.ts#closed Program selectors",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-047",
    "spec": "pipeline-program-v1",
    "section": "Exact nine-kind IR union",
    "group": "program",
    "owner": "program",
    "item": "rp-03",
    "suite": "test/program/contracts/node-union.test.ts#closed Program node union",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-048",
    "spec": "pipeline-program-v1",
    "section": "Parallel and consensus lowering",
    "group": "program",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/lowering/generated-topology.test.ts#exact generic-parallel routing table",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-049",
    "spec": "pipeline-program-v1",
    "section": "Repeat, map, wait, gate, and call semantics",
    "group": "program",
    "owner": "program",
    "item": "rp-03",
    "suite": "test/compiler/lowering/direct-structured-contracts.test.ts#direct and structured node lowering contracts",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-050",
    "spec": "pipeline-program-v1",
    "section": "Exact requirements",
    "group": "program",
    "owner": "program",
    "item": "rp-03",
    "suite": "test/compiler/emission/bundle.test.ts#deduplicates identical requirements",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-051",
    "spec": "pipeline-program-v1",
    "section": "Exact provenance and synthesized IDs",
    "group": "program",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/emission/invariants.test.ts#covers every emitted region and node with exactly one provenance record",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-052",
    "spec": "pipeline-program-v1",
    "section": "Dataflow, faults, and portability",
    "group": "program",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/dataflow/selector-matrix.test.ts#compiler dataflow matrix",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-053",
    "spec": "pipeline-source-v1",
    "section": "Scope",
    "group": "source",
    "owner": "source",
    "item": "rp-02",
    "suite": "test/source/contracts/contract.test.ts#source contract",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-054",
    "spec": "pipeline-source-v1",
    "section": "Portable values and schema dialect",
    "group": "source",
    "owner": "foundation",
    "item": "rp-01",
    "suite": "test/foundation/schema.test.ts#closed TypeBox schema helper",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-055",
    "spec": "pipeline-source-v1",
    "section": "Selectors, mappings, conditions, and targets",
    "group": "source",
    "owner": "source",
    "item": "rp-02",
    "suite": "test/source/semantics/selectors-context.test.ts#source selectors and contexts",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-056",
    "spec": "pipeline-source-v1",
    "section": "Source envelope and regions",
    "group": "source",
    "owner": "source",
    "item": "rp-02",
    "suite": "test/source/semantics/region-graph.test.ts#source region graph",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-057",
    "spec": "pipeline-source-v1",
    "section": "Exact source node union",
    "group": "source",
    "owner": "source",
    "item": "rp-02",
    "suite": "test/source/contracts/node-union.test.ts#source node union",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-058",
    "spec": "pipeline-source-v1",
    "section": "Node semantics and validation",
    "group": "source",
    "owner": "source",
    "item": "rp-02",
    "suite": "test/source/semantics/node-semantics.test.ts#source node semantics",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-059",
    "spec": "pipeline-source-v1",
    "section": "Scope input, terminal results, and child failure",
    "group": "source",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/dataflow/scope-dominance.test.ts#compiler selector scopes and route dominance",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-060",
    "spec": "pipeline-source-v1",
    "section": "Dataflow and schema compatibility",
    "group": "source",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/dataflow/selector-matrix.test.ts#integer to number widening",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-061",
    "spec": "pipeline-source-v1",
    "section": "Linking, bounds, and diagnostics",
    "group": "source",
    "owner": "compiler",
    "item": "rp-03",
    "suite": "test/compiler/linking/diagnostics.test.ts#compiler linking diagnostics",
    "evidence_state": "active"
  },
  {
    "requirement_id": "req-062",
    "spec": "pipeline-source-v1",
    "section": "Compile-time extension seam",
    "group": "source",
    "owner": "extensions",
    "item": "rp-06",
    "suite": "conformance-extension-seam-absence",
    "evidence_state": "planned"
  }
]
```
