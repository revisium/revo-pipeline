# ADR 0001: Portable pipeline boundary

- Status: Accepted
- Date: 2026-07-23

## Context

Pipeline topology, durable run state, and orchestrator bindings previously risked becoming
one stateful subsystem. That prevents deterministic testing and makes persistence or
worker choices leak into graph semantics.

## Decision

`@revisium/revo-pipeline` owns portable definition/compilation and pure transition
decisions. The defining equation is:

```text
CompiledPipeline + PipelineFacts -> PipelineDecision
```

The package owns branch, fork, join, consensus, and human-gate semantics. It does not own
run/attempt state, ids, clocks, persistence, CAS, leases, retry scheduling, resume,
host-specific `ExecutionPlan` bindings, executors, or frameworks.

`@revisium/revo-run` may depend on this package. Reverse dependency is forbidden.
The orchestrator compiles host bindings and coordinates workers/adapters.

## Consequences

- Semantics remain deterministic and database-independent.
- The run package can apply decisions atomically without duplicating graph policy.
- A gate is graph semantics here but durable waiting and answer recording live in run.
- Consensus is a graph decision rule here but candidate execution and outputs live
  outside.
- Pipeline definitions cannot reference host implementation objects.
