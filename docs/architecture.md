# Architecture

`@revisium/revo-pipeline` is a zero-runtime-dependency ESM library for portable graph
definitions, deterministic compilation, and one pure semantic decision from supplied
facts.

```text
PipelineDefinition --compilePipeline--> CompiledPipeline
CompiledPipeline + PipelineFacts --decidePipeline--> PipelineDecision
```

The accepted API is planned but not shipped: the root source remains exactly `export {};`.
Graph algorithms, definition compilation, and core task/branch/terminal transition
evaluation are implemented behind internal layer barrels. Coordination-node transition
evaluation remains the next slice, so the current internal evaluator rejects compiled
graphs containing coordination nodes rather than exposing partial behavior.

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
[module structure](./specs/internal-module-structure.spec.md) specifications own exact
type, ordering, bound, fault, and dependency details.
