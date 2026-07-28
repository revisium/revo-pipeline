# State machine

## Complete facts

`PipelineFacts` is one complete point-in-time host projection:

- `values`: every currently owned pipeline-global scalar value;
- `nodes`: activated nodes, either `enabled` or terminal with an outcome;
- `candidateVerdicts`: normalized consensus candidate facts;
- `gateResolutions`: accepted human-gate resolution facts.

Omission from `nodes` means “not activated”; there is no active/waiting node fact.
Facts must satisfy foreign-key, duplicate, outcome, causality, and premature-evidence
rules before progress. `PipelineDefinition.facts` is one pipeline-global namespace:
each key is unique, has one declared scalar type, and branches reference it globally.
There is no node-local namespace. `values` is complete, not merely relevant to the
current wait.

`JsonScalar` is `null | boolean | number | string`, and `FactType` is `'null' |
'boolean' | 'number' | 'string'`. Numbers are finite safe integers; strings follow NFC
and canonical limits; `-0` is normalized. Only `init`, completed `taskOutcome`, and
`humanGateResolution` commands carry values. Keys are unique, declared, type-correct,
and canonicalized in declaration order. `consensusVerdict` carries none. Reducer
records retain one semantic source; a second source for a key is `COMMAND_CONFLICT`,
even with an equal scalar.

`JoinArrival` is not a public type or fact; join readiness is derived from declared
terminal exit-task facts in the complete projection.

## Decisions

The six variants are `activate`, `select`, `wait`, `terminal`, defensive `noop`, and
`reject`. Precedence is validation/reject, reached terminal, first actionable intent
in canonical topological order, first deterministic wait, then defensive noop. A wait
never hides later work and a reached terminal outranks residual losing-branch work.

## Reduction

Snapshots are `uninitialized`, settled `active`, or settled `terminal`. Commands are
`init`, `taskOutcome`, `consensusVerdict`, and `humanGateResolution`. Narrow results by
`ok`, then `status`. Successful reduction is always `waiting` or `terminal`;
`application` is `applied` or exact-replay `unchanged`. Replay stays unchanged even
after later progress and has an empty atomic batch; different content for the same
semantic identity is a conflict. Effects are ordered data and the entire batch is
indivisible.

| Node        | Pure behavior                                                                         |
| ----------- | ------------------------------------------------------------------------------------- |
| `task`      | Waits for a supplied terminal task outcome and routes it.                             |
| `branch`    | Selects one disjoint predicate case or default from a declared global value.          |
| `fork`      | Completes and atomically activates canonical branch entries plus its reciprocal join. |
| `join`      | Derives readiness/outcome from terminal declared branch exits.                        |
| `consensus` | Derives a declared outcome from supplied candidate verdicts and policy.               |
| `humanGate` | Waits for and selects one declared portable resolution.                               |
| `terminal`  | Reports its declared pipeline outcome.                                                |

Successful compile, decode, and reduction results are newly owned and deeply frozen.
`definePipeline` is only readonly identity and does not freeze its argument.

## Diagnostics

Program logic uses stable codes rather than messages. Paths are deterministic RFC 6901
pointers. At most 100 faults are returned: the first 99 plus the appropriate fixed
overflow sentinel (`DEF_LIMIT`, `FACT_LIMIT`, `DECODE_DIAGNOSTIC_LIMIT`, or
`REDUCTION_DIAGNOSTIC_LIMIT`). Messages are bounded diagnostic context. Portable input
guarantees do not promise equivalent behavior for hostile ECMAScript proxies.
