# Architecture

## Lifecycle

[ADR 0005](./adr/0005-greenfield-language-compiler-kernel-cutover.md) sets the
direct-cutover architecture. [ADR 0011](./adr/0011-under-development-package-entrypoints.md)
allows the exact package facades to be evaluated independently while the six contracts
remain Draft. [ADR 0012](./adr/0012-alpha-prerelease-publication.md) permits only
unstable prerelease publication under the npm `alpha` tag; it makes no compatibility or
consumer-integration readiness claim. [ADR 0013](./adr/0013-curated-execution-plan-bridge.md)
adds one separate, intentionally small execution-plan consumer facade.

## System shape

The package is a strict ESM, portable TypeScript language/compiler/kernel library. It
validates TypeBox-backed source and materialization documents, links and lowers them into
a closed Program IR, and advances that program as a pure state machine. It performs no
I/O and knows no runtime provider, model, DBOS workflow, attempt, database, queue, or
subscription.

Its only production dependencies are exact `typebox@1.3.10` and
`canonicalize@4.0.0`; hashing uses `node:crypto`. `fast-check`, Ajv, XState, and
host/runtime libraries are not installed.

```text
playbook PipelineSourcePackage + portable ProfileMaterialization
                              |
                              v
                  compile/link/materialize
                              |
                              v
 PipelineProgram + ProgramRequirements + ProgramProvenance
                    + programDigest
                              |
                              v
 createInitialPipelineState / advancePipeline({ program, programDigest })
                              |
                              v
             next PipelineState + host commands
```

The source language has exactly 12 node kinds: `agent`, `script`, `effect`, `choice`,
`parallel`, `repeat`, `map`, `wait`, `humanGate`, `consensus`, `call`, and `end`.
Compilation produces exactly nine IR node kinds: `activity`, `choice`, `call`,
`parallel`, `repeat`, `map`, `wait`, `humanGate`, and `end`. Control flow uses targets
and structured regions; `sequence` is not a node. Agent-slot and explicit-consensus
forms lower to ordinary IR structure, so neither `agent` nor `consensus` is an IR kind.

## Layers and dependency direction

Arrows mean “imports or depends on.” Public facades are not dependency layers.

`architecture/layers.json` is the canonical machine-readable record for layer paths and
dependency direction. Dependency-cruiser derives graph rules from it. Foundation,
source, materialization, Program, compiler, and kernel are the complete layer set.

```text
source -------------> foundation
materialization ----> foundation + source contracts
program ------------> foundation
compiler/linker ----> foundation + source + materialization + program
kernel -------------> foundation + program
```

`src/execution-plan/` is not a seventh layer. It is the ADR 0013 integration facade and may
use only curated pipeline indexes.

- **foundation** owns portable JSON, identifiers, diagnostics, bounds, canonicalization,
  hashes, and TypeBox schema helpers.
- **source** owns the closed authoring language and module/package grammar.
- **materialization** owns portable agent-slot strategy selections and abstract
  participant binding keys. Policy, participant range, remaining behavior, and routes
  stay in source.
- **program** owns the closed linked IR, provenance, and portable requirements.
- **compiler/linker** validates, links, materializes, checks dataflow and bounds, lowers
  source constructs, and emits canonical program data.
- **kernel** owns only state, events, commands, and deterministic advancement.

Stable boundaries are checked with standard TypeScript, oxlint, Vitest, and
dependency-cruiser behavior. Cross-layer imports target the dependency layer's curated
`index.ts`; same-layer peer imports are allowed. Layers do not import `src/index.ts`.
The root facade imports only the five curated indexes it exposes, while
`src/kernel/public.ts` is the second package facade. Dependency-cruiser evaluates the resolved
module graph, derives the layer DAG from the manifest, rejects classified nonproduction
packages, and applies a production-package path allowlist derived from `package.json`.
Tests and scripts retain their development tooling boundary.

These checks prevent ordinary architecture drift in a reviewed change. They do not parse
every possible source spelling and are not a security sandbox against a contributor who
changes code, configuration, and verification together.

## Language and compiler

The foundation owns bounded portable JSON cloning/freezing, NFC and surrogate checks,
identifiers, RFC 6901 pointers, fixed limits and overflow-safe arithmetic, the exact
`PipelineFailure` shape `{code,path}`, diagnostic definitions/order/truncation, closed
TypeBox object construction, RFC 8785 serialization through exact `canonicalize@4.0.0`,
and domain-separated full SHA-256 through `node:crypto`.

Canonicalization validates portable input before serialization. It rejects custom
prototypes, accessors without invocation, symbol properties, sparse arrays, cycles,
non-NFC or unpaired strings and keys, fractional or unsafe numbers, and bound overflow;
`-0` becomes `0`. General portable strings and keys have no display-string cap; the
512-code-point limit belongs only to declared display strings and fixed diagnostic
messages. Every reflection failure, including hostile or revoked proxies, becomes a
stable redacted rejection.

Closed object schemas accept no structural options and allow only `$id`, `title`, and
`description` metadata through defensive own-data descriptors. Foundation diagnostics
come only from the closed specification code catalog, contain exact frozen fields and a
valid pointer, and never accept caller messages or accessor-backed entries. The private
digest primitive checks the exact seven domains at runtime for both canonical input and
raw canonical bytes. The public digest helpers validate their complete owned input and
return only a digest or a generic value-redacted `TypeError`.

The only production dependencies are exact `typebox@1.3.10` and
`canonicalize@4.0.0`. Ajv, XState, `fast-check`, and host/runtime packages are absent.
The current foundation implementation uses `node:crypto` for SHA-256; dependency-cruiser
flags resolved imports of other Node core modules.

Foundation is also the single implementation owner of representation-neutral
ValueSchema, choice-domain, policy, normalization, projection, and finite-domain
vocabulary re-exported unchanged by source. Source owns the TypeBox-derived 12-kind
authoring graph, selectors, mappings, recursive regions, and deterministic normalization.
Its current semantic pass is intentionally local: it validates each region's entry and
targets, reachability and the ability to exit, nested-region exits and selector contexts,
human-gate answer bijections, and the finite coverage required by
`choice.otherwise: null`. Cross-module
linking, call recursion, dominance, general dataflow/schema compatibility, composed
bounds, Program lowering, and compiler-bundle digests are composed by the compiler.

Materialization owns only the portable, source-pinned selection envelope. It requires
exactly one canonical-path entry for every reachable agent slot, accepts only a strategy
declared by that source node, and rechecks source-owned participant policies. Slot keys
are path-local, so distinct agent paths may deliberately share one slot key. Normalized
source and materialization documents have separate domain-separated digests.

Program owns the recursively closed nine-kind IR, derived generic/vote result schemas,
abstract requirements, complete provenance, shared Program admission, and the exact
digest-input contract while depending only on foundation. The compiler composes the existing source/materialization
gates, then performs package linking, route-sensitive dataflow, overflow-safe activity
bounds, exact lowering, requirement/provenance emission, recursive ownership, and the
`pipeline-program/v1` digest. Compiler emission and `computeProgramDigest` use the same
own-once validation and hashing path.

## Public boundary

`@revisium/revo-pipeline` exposes the exact schema, identity-helper, compiler, and digest
manifest declared by Conformance v1. `@revisium/revo-pipeline/kernel` exposes the exact
narrow Program and pure-machine manifest. `@revisium/revo-pipeline/execution-plan` is the
separate ADR 0013 bridge facade. No other deep import is public. These are
under-development Draft contracts available from npm `alpha` prereleases and local or
CI-built tarballs, without a compatibility guarantee.

## Cross-package ownership

| Concern                 | `revo-pipeline`                                                       | `revo-core`                                                         | Host runtime                                                                                  |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Playbook source grammar | Owns schema, validation, and compilation                              | Stores/version-selects source through its data boundary             | Does not interpret source                                                                     |
| Profile materialization | Validates portable slot choices                                       | Selects profile and supplies portable materialization               | Does not select profiles                                                                      |
| Program topology        | Owns linked IR and full-bundle `programDigest`                        | Persists the admitted immutable compiler bundle                     | Recomputes/validates the bundle digest, then executes the trusted pair through the kernel     |
| Activity requirements   | Emits abstract `ProgramRequirements`                                  | Resolves exact agent, script, effect, tool, and permission bindings | Executes resolved bindings                                                                    |
| Execution plan          | Lowers the ADR 0013 choice/end slice to a pipeline-owned JSON payload | Constructs and persists a plan using its host contract              | Owns runtime admission, root-program validation, and immutable host-plan contract             |
| Run lifecycle           | Emits semantic commands only                                          | Creates and enqueues runs                                           | Owns DBOS, attempts, retries, timers, cancellation, reconciliation, events, and subscriptions |

An agent source node is a slot, not an executor declaration. Source owns the exact
allowed `single`/`consensus` strategies, consensus policy, participant range, and
remaining-work behavior. Portable profile materialization chooses only an allowed
strategy and abstract participant keys. Structural materialization may change
`programDigest`; core later resolves exact assemblies and script/effect bindings without
changing the program.

## Digest lineage

```text
PipelineSourcePackage --sourceDigest---------------------------+
          + ProfileMaterialization(sourceDigest)               |
          |                  --materializationDigest            |
          v                                                     |
PipelineProgram + ProgramRequirements + ProgramProvenance      |
                    --programDigest                            |
          + exact core bindings + run policies                 |
          v                                                     |
run-owned immutable ExecutionPlan --planDigest (core/run only)-+
```

`sourceDigest` excludes profile materialization. `materializationDigest` pins the source.
`programDigest` hashes exactly `{program,requirements,provenance}`; the program contains
both upstream digest pins. Core/run admission validates every component and recomputes
the full compiler-bundle digest. The kernel trusts the admitted `{program,programDigest}`
pair and only compares the digest with its state pin. `planDigest` is core/run-owned.

## Purity and determinism

The compiler and kernel are deterministic for the same validated inputs. Every live
frame has a structural digest key, immutable `scopeInput`, and full-ID terminal
`nodeResults`; completed children copy their result into the parent atomically before
pruning. The kernel has no I/O, clocks, randomness, persistence, hidden mutable state,
runtime IDs, or attempts. Calls are linked before execution and recursive call graphs
are rejected. Parallel, map, repeat, and consensus expansion is bounded.

Lowered Program admission and the kernel corruption guard share one frontier-aware
analysis. It accounts for the global runnable worklist, complete map preflight, live
state, command/state JSON occurrences, and cancellation hypergraph membership before a
bundle digest can be emitted. Runtime advancement uses one transition-local reverse
cancellation index and never persists a scheduler cache. Map activation persists only
the canonical key-aligned source indexes required for bounded later refill; each refill
uses binary key lookup and direct source-array access rather than repeating complete
preflight or building a hidden index. See
[ADR 0009](./adr/0009-bounded-map-collection.md) and
[ADR 0010](./adr/0010-static-machine-admission.md).

Kernel replay receipts are live-state indexes rather than an unbounded audit log. The
kernel retains an event digest only while its owning frame or cancellation cleanup can
still reference the command. The host runtime owns post-prune replay and atomically persists
the run-scoped receipt, next state, and ordered outbox. See
[ADR 0006](./adr/0006-live-kernel-receipts-and-durable-host-replay.md).

Live frame `nodeResults` remain a frozen, canonically ordered JSON record. Insertions use
binary key positioning, one ordinary copy, and one freeze. The accepted quadratic
worst-case is bounded by 4,096 results in one live frame and never by total run history;
no hidden cache or million-activity allocation is permitted. See
[ADR 0008](./adr/0008-bounded-canonical-live-node-results.md).

## Traceability

The ownership matrix records the pipeline/core/run boundary for the existing 103 intent
identifiers. It is ownership evidence, not a roadmap or a list of pipeline
implementations.
