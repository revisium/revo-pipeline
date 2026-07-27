# Architecture

`@revisium/revo-pipeline` is a zero-runtime-dependency ESM library for portable graph
definitions, deterministic compilation, and one pure semantic decision from supplied
facts.

```text
PipelineDefinition --compilePipeline--> CompiledPipeline
CompiledPipeline + PipelineFacts --decidePipeline--> PipelineDecision
```

The Accepted MVP API is shipped from the single curated root: `definePipeline`,
`compilePipeline`, `decidePipeline`, and exactly 63 readonly contract types. Internal
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

Accepted, unimplemented contracts now define a diagnostic decoder and a pure reducer.
PR6 may add `decodeCompiledPipeline` and its three types. PR7 may add `reducePipeline`
and twenty reducer types, reaching exactly five root values and 86 types. Acceptance is
not shipment: the current root remains exactly three values and 63 types.

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
