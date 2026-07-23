# Pipeline Transition v1

- Status: Draft
- Target package: `@revisium/revo-pipeline`

This document is non-executable. It defines target semantics, not current exports.

## Core contract

```text
decide(CompiledPipeline, PipelineFacts) -> PipelineDecision
```

The function is pure, deterministic, synchronous in meaning, and total for validated
input. It does not mutate either argument. Every observation capable of changing the
decision is present in `PipelineFacts`.

## Facts

Facts describe the semantic state of definition nodes without importing run persistence
types. A fact may indicate:

- a node is not activated, enabled, active, waiting, or terminal;
- a terminal task outcome and normalized outcome fields;
- a fork branch is skipped or has reached an accepted/rejected terminal condition;
- a consensus candidate has one normalized verdict;
- a human gate has no accepted resolution or one normalized accepted resolution.

V1 has one activation per semantic node because the definition graph is acyclic. Runtime
node-instance ids, run ids, attempt ids, timestamps, lease owners, fencing tokens,
versions, and database row shapes are not facts.

Facts must be self-consistent. Contradictory, missing-required, duplicate, or
definition-foreign facts produce bounded typed decision faults; the evaluator never
guesses.

## Decisions

A decision is data describing one of:

- activate a deterministic set of semantic nodes/branches;
- wait because a declared semantic prerequisite is absent;
- select a branch/consensus/gate outcome;
- declare a portable terminal outcome;
- reject incoherent facts.

Activation sets and diagnostics have stable deterministic ordering. A decision is not a
command and has no side effects. The run engine decides whether and how to persist/apply
it atomically.

## Evaluation rules

### Sequential edge

After the source reaches an outcome accepted by the compiled edge, enable the target. An
already enabled/active/terminal target is not reactivated.

### Branch

Evaluate all declared cases against supplied normalized facts. Exactly one case must be
true, or the default must be the only valid fallback. Activate only the selected target.

### Fork

When first enabled, return one decision containing every declared branch entry. The run
engine applies this set atomically or retries the same deterministic decision.

### Join

Compute readiness from current facts for the fork region and compiled completion policy.
Do not consume or emit arrival records. Re-evaluation before readiness returns wait;
re-evaluation after application does not activate the join successor twice because the
facts already show it enabled or terminal.

### Consensus

Wait while the compiled policy can still require absent candidate verdicts. Once enough
facts exist, calculate the deterministic verdict, including tie/insufficient/rejected
outcomes declared by the definition. The package never chooses which attempt or agent
output becomes a candidate fact.

### Human gate

Without an accepted resolution fact, return wait. With one resolution validated against
the compiled answer contract, select its declared outcome. Authorization, answer CAS,
answer storage, notification, and durable wake-up belong outside this package.

## Idempotence and concurrency boundary

For the same compiled graph and deeply equal facts, decisions are deeply equal. This is
semantic idempotence only. Exactly-once application, optimistic concurrency, fencing,
duplicate delivery, transactional outputs/events, and worker races are owned by
`@revisium/revo-run` and its storage adapter.

The normal host loop is conceptually:

```text
read durable facts
compute pure decision
attempt atomic run-state change against expected version
on conflict, discard and recompute from fresh facts
```

This package owns only the second line.

## Failure boundary

Definition faults arise during compilation. Decision faults arise only from facts that
are invalid against a valid compiled graph. Executor failure, retry exhaustion, lease
loss, output corruption, and persistence conflicts are not pipeline faults.
