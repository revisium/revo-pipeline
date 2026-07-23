# Pipeline Definition v1

- Status: Draft
- Target package: `@revisium/revo-pipeline`

This document is non-executable. Names and shapes are design vocabulary until the
specification is accepted and implemented.

## Goal

Represent a portable, deterministic, acyclic pipeline graph and compile it into an
immutable, normalized `CompiledPipeline`. V1 permits one semantic activation of each node
per pipeline evaluation. Loops, subruns, dynamic graph mutation, and host execution
bindings are deferred.

## Conceptual input

```text
PipelineDefinition
  schemaVersion: 1
  entry: NodeKey
  nodes: readonly PipelineNode[]

PipelineNode =
  TaskNode
  | BranchNode
  | ForkNode
  | JoinNode
  | ConsensusNode
  | HumanGateNode
  | TerminalNode
```

`NodeKey` is a definition-local semantic key. It is not a run id, database primary key,
runtime node-instance id, idempotency key, or lease token.

All retained input is copied into package-owned readonly values. Input and compiled
values are plain JSON-compatible data. Compilation must not retain caller-owned mutable
containers.

## Node semantics

### Task

A task marks a semantic unit whose implementation is bound later by the orchestrator.
The node contains graph policy only: its key and outgoing outcome edges. It does not
contain an agent object, model profile, prompt body, script implementation, credentials,
workspace, timeout clock, lease, or retry scheduler.

### Branch

A branch has ordered, uniquely named cases and an optional default. Each case references
a portable predicate over explicitly declared fact fields. Predicate evaluation is
deterministic, total within supported types, and cannot execute code or perform I/O.
Exactly one case is selected; ambiguity is a definition error, not first-match behavior.

### Fork

A fork declares two or more uniquely named branches and their entry nodes. It enables all
declared branches as one semantic decision. It does not enqueue work or create node rows.

### Join

A join names its owning fork and a completion policy:

- `all`: every non-skipped branch reaches an accepted terminal condition;
- `any`: the first accepted branch is sufficient and remaining-branch disposition is
  described by policy;
- `threshold`: at least the declared number of branches is accepted.

Join readiness is derived from supplied branch/node facts. There is no `JoinArrival`
contract or hidden arrival counter in this package.

Compilation proves that join members belong to one fork region, that policies are
satisfiable, and that outgoing edges cannot bypass the declared barrier.

### Consensus

A consensus node names a closed candidate set and a deterministic policy such as
unanimous, quorum, or threshold. It consumes normalized candidate verdict facts, not
agent responses or artifacts. Compilation checks candidate membership, quorum bounds,
tie policy, and exhaustive outcomes.

Candidate execution, attempt selection, output persistence, model routing, and cost
accounting are outside this package.

### Human gate

A human gate describes:

- a semantic subject and answer contract;
- permitted normalized resolutions;
- deterministic mapping from each resolution to an outgoing outcome;
- optional reject/cancel outcomes.

It does not define an inbox row, authorization backend, waiter, deadline clock, user id,
CAS operation, or persisted gate entity. Durable waiting is represented by a run node
instance; an accepted answer is a durable output supplied later as facts.

### Terminal

A terminal node declares one portable semantic outcome. Product verdict projection is
host-owned.

## Compilation

Conceptually:

```text
compile(PipelineDefinition) -> CompiledPipeline | DefinitionFaults
```

Compilation is deterministic and side-effect free. Given deeply equal input, it produces
deeply equal compiled data and ordered diagnostics.

Validation accumulates bounded diagnostics for:

- unsupported schema version and unknown fields;
- missing, duplicate, or malformed node keys;
- missing entry, missing edge target, unreachable node, and dead end;
- value or type incompatible with a node kind;
- graph cycle in V1;
- ambiguous/non-exhaustive branch;
- fork/join ownership, membership, nesting, and satisfiability;
- consensus candidate/quorum/tie incoherence;
- gate resolution/outcome incoherence;
- duplicate or contradictory edges;
- limits on nodes, edges, cases, branches, candidates, nesting, and diagnostics.

`CompiledPipeline` contains normalized topology, indexes, and semantic policy needed for
decisions. It remains portable and serializable. It is not the orchestrator's
`ExecutionPlan`: no model/profile/prompt/agent/script/workspace/provider binding is
present.

## Explicit exclusions

No ids or timestamps are generated. No environment, database, filesystem, process,
network, queue, or clock is read. The package does not persist or cache compilation,
select an executor, retry work, resume a run, or apply a transition.
