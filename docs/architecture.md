# Architecture

`@revisium/revo-pipeline` is a zero-runtime-dependency ESM library for portable graph
definitions, deterministic compilation, safe decoding, pure decisions, and pure
reduction from supplied data.

```text
PipelineDefinition --compilePipeline--> CompiledPipeline
unknown JSON --decodeCompiledPipeline--> CompiledPipelineDecoding
CompiledPipeline + PipelineFacts --decidePipeline--> PipelineDecision
CompiledPipeline + PipelineSnapshot + PipelineCommand --reducePipeline--> PipelineReduction
```

The Accepted MVP API is shipped from the single curated root: `definePipeline`,
`compilePipeline`, `decidePipeline`, `decodeCompiledPipeline`, `reducePipeline`, and exactly 86 readonly contract types. Internal
policy, graph, compiled-data validation, and decoder helpers are not exported.
Fork/join readiness, consensus, and human-gate decisions are calculated exclusively
from compiled topology and the supplied portable fact snapshot.

## Ownership boundary

The package owns task, branch, fork, join, consensus, human-gate, and terminal graph
semantics; bounded validation; immutable normalized topology; and pure decisions. It
does not own a run, node instance, attempt, output, event, time, ID, clock, lease, CAS,
retry, resume, persistence, queue, authorization, inbox, notification, agent, script,
model/profile/prompt/workspace/provider binding, or host lifecycle. It never accepts a
`JoinArrival` or a host execution-plan object.

Any future host may depend on this package; reverse dependency is forbidden. A host reads
durable state, maps it to portable inputs, applies effects, and reloads after conflicts.
The decision/reducer integration seam, plan compilation, legacy graph migration, durable
reconstruction, and persistence/CAS mapping remain host architecture work outside this
package.

The diagnostic decoder and pure reducer are shipped. Reduction adds twenty readonly
contract types, reaching exactly five root values and 86 types.

Package verification has one command boundary:
`verify-package -> package-command-runner -> node:child_process`. The runner exposes only
pack, publint, ATTW, extraction, artifact preparation, TypeScript, consumer execution,
completion, and path-free disposal capabilities. One frozen nominal package artifact and
one runner-private reader supply an opaque semantic access object for every packed check
and trusted repository fixture. A separate artifact-tree module is the sole
post-extraction filesystem/path boundary. It copies the generic lockfile-resolved type
closure as ordinary files, audits the isolated tree immediately before each runtime
launch, and supports fixed semantic reads, fixture creation, and resolution assertions
rather than caller-selected paths. Runtime fixtures launch under Node's
permission model with read access only to the isolated root; direct outside reads, all
writes, child processes, and workers are negative probes. These controls are
defense-in-depth for trusted same-process fixtures, not a sandbox, malicious-code
containment, or a race-free filesystem guarantee. A finite static validator snapshots the
canonical imports, public capability surfaces, sole child-process call, exact runtime
flags/environment/stdio, direct verifier sequence, unconditional disposal, and absence of
retired analyzers. The verifier preserves a primary failure when cleanup succeeds and
reports ordered primary/cleanup failures together when both fail. Successful completion
is terminal for the runner.
Compiled input admits at most 128 distinct fact keys, so a valid public reduction can
reach but cannot exceed 128 source-owned values without first colliding with an existing
owner. A live pre-mutation prospective-count guard remains mandatory and is protected by
an AST proof against bypass, decoys, and off-by-one drift.
Command precedence is recorded identity replay/conflict, then target lifecycle, then
prospective source ownership and value-count bounds. Consequently an omitted target
reports `COMMAND_STATE` even when its proposed value collides, while an already recorded
identity retains replay/conflict precedence.
A terminal task or gate necessarily carries its recorded command identity, so replay or
conflict remains observable before lifecycle; completed tasks cannot be retired by
terminal closure. Omitted future task/gate targets and a retired unresolved gate are the
publicly reachable `COMMAND_STATE` cross-source collision cases.

One reducer occurrence is one complete finite DAG traversal. Occurrence keys isolate
independent executions; bounded interior rework is compile-time, forward-only unrolling
under distinct node keys in the same occurrence. The package returns one ordered atomic
semantic effect batch. A host owns persistence and CAS, applies the whole batch, and
reloads and recomputes everything after a conflict.

## Semantic invariants

- Branch predicates are data; case domains are disjoint, so selection is never
  first-match.
- Fork/join readiness comes only from declared exit-node facts. Nested forks and hidden
  mutable arrivals/counters are excluded in v1.
- Decisions validate compiled integrity and causal facts before choosing an outcome;
  terminal beats residual work, actions beat waits, and quiescence is explicit.
- `CompiledPipeline` is portable, JSON-round-trippable canonical data, not a host binding.

The accepted [definition](./specs/pipeline-definition-v1.spec.md),
[transition](./specs/pipeline-transition-v1.spec.md), and
[decoding](./specs/pipeline-decoding-v1.spec.md),
[reducer](./specs/pipeline-reducer-v1.spec.md), and
[module structure](./specs/internal-module-structure.spec.md) specifications own exact
type, ordering, bound, fault, and dependency details. The Accepted
[ADR](./adr/0002-portable-decoding-and-reduction.md) records the package/host boundary.
