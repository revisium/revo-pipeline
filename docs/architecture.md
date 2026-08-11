# Architecture

## Lifecycle

[ADR 0005](./adr/0005-greenfield-language-compiler-kernel-cutover.md) is Accepted and
sets the direct-cutover architecture. The six contracts in `docs/specs/` remain Draft
through `rp-06`. `rp-01` activates only the private foundation layer while retaining the
inert root module and unconditional publication refusal; it exposes no consumer API.

## System shape

The package is a strict ESM, portable TypeScript language/compiler/kernel library. It
validates TypeBox-backed source and materialization documents, links and lowers them into
a closed Program IR, and advances that program as a pure state machine. It performs no
I/O and knows no runtime provider, model, DBOS workflow, attempt, database, queue, or
subscription.

Starting in `rp-01`, its only production dependencies are exact `typebox@1.3.10` and
`canonicalize@3.0.0`; hashing uses `node:crypto`. `fast-check`, Ajv, XState, and
host/runtime libraries are not installed in `rp-01`.

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

Arrows mean “imports or depends on.” Every layer is private unless Conformance v1 names
it in the final manifest.

`architecture/layers.json` is the canonical machine-readable record for activation,
paths, dependency direction, and visibility. Dependency-cruiser derives graph rules
from it, while concise contract tests pin the current activation and filesystem. At
`rp-01`, foundation is active; all six later records are future and have no source
directories.

```text
source -------------> foundation
materialization ----> foundation + source contracts
program ------------> foundation
compiler/linker ----> foundation + source + materialization + program
kernel -------------> foundation + program
extensions/tooling -> source + materialization + compiler (compile time only)
```

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
- **extensions/tooling** may lower built-in authoring forms before canonical source
  validation. The first alpha seam is internal and compile-time only.

Stable boundaries are checked with standard TypeScript, oxlint, Vitest, and
dependency-cruiser behavior. Cross-layer imports target the dependency layer's curated
`index.ts`; same-layer peer imports are allowed. Layers do not import `src/index.ts`, and
the inert root does not import a private layer. Dependency-cruiser evaluates the resolved
module graph, derives the layer DAG from the manifest, rejects classified nonproduction
packages, and applies a production-package path allowlist derived from `package.json`.
Tests and scripts retain their development tooling boundary.

These checks prevent ordinary architecture drift in a reviewed change. They do not parse
every possible source spelling and are not a security sandbox against a contributor who
changes code, configuration, and verification together.

## Active `rp-01` foundation

The foundation owns bounded portable JSON cloning/freezing, NFC and surrogate checks,
identifiers, RFC 6901 pointers, fixed limits and overflow-safe arithmetic, the exact
`PipelineFailure` shape `{code,path}`, diagnostic definitions/order/truncation, closed
TypeBox object construction, RFC 8785 serialization through exact `canonicalize@3.0.0`,
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
raw canonical bytes; it does not add the final `rp-06` public digest wrappers.

The only production dependencies are exact `typebox@1.3.10` and
`canonicalize@3.0.0`. Ajv, XState, `fast-check`, and host/runtime packages are absent.
The current foundation implementation uses `node:crypto` for SHA-256; dependency-cruiser
flags resolved imports of other Node core modules.

Publication remains blocked by `private: true`, absent public entrypoints, and an
unconditional failing `prepublishOnly` hook. A concise contract test checks the ordinary
reviewed state: exact production dependencies, no public package fields, an inert root,
and `ci.yml` as the only workflow. Review remains responsible for workflow changes.

## Public boundary

There is no public runtime boundary through `rp-01`. At `rp-06`, the root export becomes
the exact schema/identity-helper/compiler/digest manifest declared by Conformance v1,
and `@revisium/revo-pipeline/kernel` becomes the exact narrow Program IR and pure machine
manifest. No other deep import is public. Earlier work items must not expose either
entrypoint.

## Cross-package ownership

| Concern                 | `revo-pipeline`                                | `revo-core`                                                         | `revo-run`                                                                                    |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Playbook source grammar | Owns schema, validation, and compilation       | Stores/version-selects source through its data boundary             | Does not interpret source                                                                     |
| Profile materialization | Validates portable slot choices                | Selects profile and supplies portable materialization               | Does not select profiles                                                                      |
| Program topology        | Owns linked IR and full-bundle `programDigest` | Persists the admitted immutable compiler bundle                     | Recomputes/validates the bundle digest, then executes the trusted pair through the kernel     |
| Activity requirements   | Emits abstract `ProgramRequirements`           | Resolves exact agent, script, effect, tool, and permission bindings | Executes resolved bindings                                                                    |
| Execution plan          | Has no plan API                                | Constructs and persists a plan using run's contract                 | Owns schema, admission, root-program validation, and immutable plan contract                  |
| Run lifecycle           | Emits semantic commands only                   | Creates and enqueues runs                                           | Owns DBOS, attempts, retries, timers, cancellation, reconciliation, events, and subscriptions |

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

## Traceability

The ownership matrix contains 103 unique traceability rows. Primary ownership is
compiler 22, kernel 32, core 7, and run 42. Compiler plus kernel produce 54
pipeline-evidence obligations; core plus run produce 49 host/cross-package evidence
obligations. These counts preserve intent and ownership; they do not request 103
separate pipeline implementations.

The delivery-plan requirement table assigns a stable ID, specification section, group,
owner, item, suite, and evidence state. A structural test checks its 62 unique rows,
derives coverage of all 48 specification sections, and resolves active `rp-00`/`rp-01`
suite paths and markers without duplicating the table. Later labels are documentation-
only planned evidence. Canonical byte/domain primitives land in foundation, while
artifact, base-machine, and coordination semantics remain assigned to `rp-03`, `rp-04`,
and `rp-05` without creating their future layers early.

## Sequential delivery

- `rp-00`: physical reset, architecture/docs baseline, Draft specs, and publication
  block.
- `rp-01`: portable foundation, schemas, canonicalization, hashing, diagnostics, and
  bounds.
- `rp-02`: source language, agent slots, and profile materialization.
- `rp-03`: compiler/linker, Program IR, requirements, provenance, and digests.
- `rp-04`: base pure kernel for activity, choice, call, end, data, and base cancellation.
- `rp-05`: parallel, consensus lowering, repeat, map, wait, gate, and coordination.
- `rp-06`: conformance, cross-package readiness, final manifests, and lifecycle
  acceptance.

All work items before `rp-06` remain nonpublishable. `rp-06` readiness does not itself
publish; release remains a separate human gate.
