# Architecture

## Lifecycle

[ADR 0005](./adr/0005-greenfield-language-compiler-kernel-cutover.md) is Accepted and
sets the direct-cutover architecture. The six contracts in `docs/specs/` remain Draft
through `rp-06`. The `rp-00` repository state is an inert source module plus a
fail-closed publication block; it exposes no consumer API.

## System shape

The package is a strict ESM, portable TypeScript language/compiler/kernel library. It
validates TypeBox-backed source and materialization documents, links and lowers them into
a closed Program IR, and advances that program as a pure state machine. It performs no
I/O and knows no runtime provider, model, DBOS workflow, attempt, database, queue, or
subscription.

Starting in `rp-01`, its only production dependencies are exact `typebox@1.3.10` and
`canonicalize@3.0.0`; hashing uses `node:crypto`. `fast-check` is development-only. Ajv,
XState, and host/runtime libraries are not production dependencies.

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

Stable boundaries are checked declaratively; behavior and package tests own observable
semantics.

## Public boundary

There is no public runtime boundary in the reset. At `rp-06`, the root export becomes
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
