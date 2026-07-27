# Architecture

`@revisium/revo-pipeline` is a zero-runtime-dependency ESM library for portable graph
definitions, deterministic compilation, and one pure semantic decision from supplied
facts.

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

`@revisium/revo-run` may depend on this package; reverse dependency is forbidden. A host
reads durable state, maps it to portable facts, atomically applies a decision, and reloads
after conflicts. That host work is deliberately outside this package.

The diagnostic decoder and pure reducer are shipped. Reduction adds twenty readonly
contract types, reaching exactly five root values and 86 types.
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
