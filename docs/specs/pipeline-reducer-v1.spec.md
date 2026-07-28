# Pipeline Reducer v1

- Status: Accepted
- Implementation: Shipped by PR7
- Target package: `@revisium/revo-pipeline`

## Public state and command contract

```ts
export type PipelineOccurrenceKey = string;
export type PipelineNodeOccurrence = {
  readonly occurrenceKey: PipelineOccurrenceKey;
  readonly nodeKey: NodeKey;
};
export type PipelineTerminal = {
  readonly occurrence: PipelineNodeOccurrence;
  readonly outcome: string;
};
export type PipelineValueSource =
  | { readonly kind: 'init'; readonly occurrenceKey: PipelineOccurrenceKey }
  | { readonly kind: 'taskOutcome'; readonly occurrence: PipelineNodeOccurrence }
  | { readonly kind: 'humanGateResolution'; readonly occurrence: PipelineNodeOccurrence };
export type PipelineValueRecord = {
  readonly fact: PipelineValueFact;
  readonly source: PipelineValueSource;
};
export type PipelineSnapshotNode =
  | { readonly occurrence: PipelineNodeOccurrence; readonly state: 'enabled' }
  | {
      readonly occurrence: PipelineNodeOccurrence;
      readonly state: 'terminal';
      readonly outcome: string;
    }
  | {
      readonly occurrence: PipelineNodeOccurrence;
      readonly state: 'retired';
      readonly terminal: PipelineTerminal;
    };
export type PipelineCandidateVerdictRecord = {
  readonly occurrence: PipelineNodeOccurrence;
  readonly candidate: CandidateKey;
  readonly verdict: 'approve' | 'reject' | 'abstain';
};
export type PipelineGateResolutionRecord = {
  readonly occurrence: PipelineNodeOccurrence;
  readonly resolution: ResolutionName;
};
```

`PipelineSnapshot` is the closed union:

```ts
export type PipelineSnapshot =
  | {
      readonly schemaVersion: 1;
      readonly occurrenceKey: PipelineOccurrenceKey;
      readonly phase: 'uninitialized';
      readonly values: readonly [];
      readonly nodes: readonly [];
      readonly candidateVerdicts: readonly [];
      readonly gateResolutions: readonly [];
      readonly terminal: null;
    }
  | {
      readonly schemaVersion: 1;
      readonly occurrenceKey: PipelineOccurrenceKey;
      readonly phase: 'active';
      readonly values: readonly PipelineValueRecord[];
      readonly nodes: readonly (
        | { readonly occurrence: PipelineNodeOccurrence; readonly state: 'enabled' }
        | {
            readonly occurrence: PipelineNodeOccurrence;
            readonly state: 'terminal';
            readonly outcome: string;
          }
      )[];
      readonly candidateVerdicts: readonly PipelineCandidateVerdictRecord[];
      readonly gateResolutions: readonly PipelineGateResolutionRecord[];
      readonly terminal: null;
    }
  | {
      readonly schemaVersion: 1;
      readonly occurrenceKey: PipelineOccurrenceKey;
      readonly phase: 'terminal';
      readonly values: readonly PipelineValueRecord[];
      readonly nodes: readonly PipelineSnapshotNode[];
      readonly candidateVerdicts: readonly PipelineCandidateVerdictRecord[];
      readonly gateResolutions: readonly PipelineGateResolutionRecord[];
      readonly terminal: PipelineTerminal;
    };
```

```ts
export type PipelineCommand =
  | {
      readonly schemaVersion: 1;
      readonly kind: 'init';
      readonly values: readonly PipelineValueFact[];
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: 'taskOutcome';
      readonly occurrence: PipelineNodeOccurrence;
      readonly outcome: TaskOutcome;
      readonly values: readonly PipelineValueFact[];
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: 'consensusVerdict';
      readonly occurrence: PipelineNodeOccurrence;
      readonly candidate: CandidateKey;
      readonly verdict: 'approve' | 'reject' | 'abstain';
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: 'humanGateResolution';
      readonly occurrence: PipelineNodeOccurrence;
      readonly resolution: ResolutionName;
      readonly values: readonly PipelineValueFact[];
    };
```

There is no `createPipeline`, standalone `valueFact`, generic command array, mutable
session, or persistence-owned command. Compound values apply indivisibly with their
semantic source; consensus verdicts carry no values.

## Effects and result

```ts
export type PipelineForkRelation =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'branch';
      readonly forkNodeKey: NodeKey;
      readonly joinNodeKey: NodeKey;
      readonly branch: BranchName;
      readonly role: 'entry' | 'member' | 'exit' | 'entryExit';
    }
  | {
      readonly kind: 'join';
      readonly forkNodeKey: NodeKey;
      readonly joinNodeKey: NodeKey;
      readonly role: 'join';
    };
export type PipelineRetirement = {
  readonly occurrence: PipelineNodeOccurrence;
  readonly fork: PipelineForkRelation;
};
export type PipelineEffect =
  | {
      readonly kind: 'initialize';
      readonly occurrenceKey: PipelineOccurrenceKey;
      readonly values: readonly PipelineValueFact[];
    }
  | {
      readonly kind: 'completeTask';
      readonly occurrence: PipelineNodeOccurrence;
      readonly outcome: TaskOutcome;
      readonly values: readonly PipelineValueFact[];
    }
  | {
      readonly kind: 'recordConsensusVerdict';
      readonly occurrence: PipelineNodeOccurrence;
      readonly candidate: CandidateKey;
      readonly verdict: 'approve' | 'reject' | 'abstain';
    }
  | {
      readonly kind: 'resolveHumanGate';
      readonly occurrence: PipelineNodeOccurrence;
      readonly resolution: ResolutionName;
      readonly values: readonly PipelineValueFact[];
    }
  | {
      readonly kind: 'completeSelector';
      readonly occurrence: PipelineNodeOccurrence;
      readonly outcome: string;
    }
  | {
      readonly kind: 'activateNode';
      readonly occurrence: PipelineNodeOccurrence;
      readonly cause: ActivationCause;
      readonly fork: PipelineForkRelation;
    }
  | {
      readonly kind: 'terminatePipeline';
      readonly terminal: PipelineTerminal;
      readonly retirements: readonly PipelineRetirement[];
    };
export type PipelineEffectBatch = {
  readonly kind: 'atomic';
  readonly items: readonly PipelineEffect[];
};
export type PipelineWait = {
  readonly occurrence: PipelineNodeOccurrence;
  readonly reason: WaitReason;
};
export type PipelineCommandApplication = 'applied' | 'unchanged';
export type PipelineReductionStatus = 'waiting' | 'terminal';
```

```ts
export type PipelineReductionFaultCode =
  | 'PIPELINE_TYPE'
  | 'PIPELINE_LIMIT'
  | 'PIPELINE_SCHEMA'
  | 'PIPELINE_REFERENCE'
  | 'PIPELINE_GRAPH'
  | 'PIPELINE_CANONICAL'
  | 'SNAPSHOT_TYPE'
  | 'SNAPSHOT_LIMIT'
  | 'SNAPSHOT_SCHEMA'
  | 'SNAPSHOT_DUPLICATE'
  | 'SNAPSHOT_FOREIGN'
  | 'SNAPSHOT_OUTCOME'
  | 'SNAPSHOT_CANDIDATE'
  | 'SNAPSHOT_RESOLUTION'
  | 'SNAPSHOT_PREMATURE'
  | 'SNAPSHOT_CAUSAL'
  | 'SNAPSHOT_PHASE'
  | 'SNAPSHOT_UNSETTLED'
  | 'COMMAND_TYPE'
  | 'COMMAND_LIMIT'
  | 'COMMAND_SCHEMA'
  | 'COMMAND_DUPLICATE'
  | 'COMMAND_TARGET'
  | 'COMMAND_OUTCOME'
  | 'COMMAND_CONFLICT'
  | 'COMMAND_STATE'
  | 'REDUCTION_STEP_LIMIT'
  | 'REDUCTION_INVARIANT'
  | 'REDUCTION_DIAGNOSTIC_LIMIT';
export type PipelineReductionFault = {
  readonly code: PipelineReductionFaultCode;
  readonly path: string;
  readonly message: string;
};
type PipelineReductionSuccessBase = {
  readonly ok: true;
  readonly application: PipelineCommandApplication;
  readonly snapshot: PipelineSnapshot;
  readonly batch: PipelineEffectBatch;
};
export type PipelineReduction =
  | (PipelineReductionSuccessBase & {
      readonly status: 'waiting';
      readonly wait: PipelineWait;
      readonly terminal: null;
    })
  | (PipelineReductionSuccessBase & {
      readonly status: 'terminal';
      readonly wait: null;
      readonly terminal: PipelineTerminal;
    })
  | { readonly ok: false; readonly faults: readonly PipelineReductionFault[] };
export declare function reducePipeline(
  pipeline: CompiledPipeline,
  snapshot: PipelineSnapshot,
  command: PipelineCommand,
): PipelineReduction;
```

Failure returns no snapshot or batch. Success returns newly owned, deeply frozen data.
There is no reducer `quiescent` success. `COMMAND_CONFLICT` occurs exactly once above.

## Occurrences and finite rework

An occurrence key is a host-assigned opaque NFC semantic name of 1–64 Unicode code
points. The reducer compares it only for exact equality; it never generates, parses,
orders, increments, hashes, or persists it. Every occurrence-bearing snapshot record,
command, wait, terminal, provenance record, effect, and retirement MUST match the
snapshot key. A foreign snapshot record is `SNAPSHOT_FOREIGN`; a foreign command is
`COMMAND_TARGET`. One logical node key occurs at most once in an occurrence.

One key means one complete traversal from the compiled entry. Separate executions and
full restarts use separate keys. A new key MUST NOT represent interior retry/rework.
Bounded rework MUST be compiled as a finite acyclic chain:

```text
entry -> prepare -> developer.1 -> review.1
                                   approved -> final
                                   rework -> developer.2 -> review.2
                                                              approved -> final
                                                              rework -> exhausted
```

For maximum `N`, there are at most `N` distinct developer/review node copies; the last
rework route is explicit exhaustion. Entry and preparation run once, prior values remain
append-only under distinct fact keys, and no back-edge or reactivation exists. Inside a
fork, all copies stay in the same region and only the declared final exit drives join
readiness. A final join or gate activates once. Private host display/iteration metadata
is not pipeline data.

## Settledness, replay, and drain

Snapshot phases have these exact invariants:

| Phase           | Required invariant                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uninitialized` | all four collections are empty and `terminal` is `null`                                                                                                                                                                                      |
| `active`        | no retired nodes; `terminal` is `null`; projected facts are causally valid; the initial private decision is exactly `wait`                                                                                                                   |
| `terminal`      | no enabled nodes; exactly one reached terminal matches `snapshot.terminal`; every retirement carries that exact terminal summary; projected facts after retirement filtering are causally valid; the private decision re-emits that terminal |

For active input, `activate`, `select`, `terminal`, `reject`, or `noop` is
`SNAPSHOT_UNSETTLED`. Projection strips the common occurrence key into existing facts
while preserving source paths for diagnostics.

Command identity and replay content are exact:

| Command               | Semantic identity                         | Exact replay content                            |
| --------------------- | ----------------------------------------- | ----------------------------------------------- |
| `init`                | snapshot occurrence key                   | complete normalized initial value set           |
| `taskOutcome`         | exact node occurrence                     | outcome plus complete source-owned value set    |
| `consensusVerdict`    | exact consensus occurrence plus candidate | complete verdict                                |
| `humanGateResolution` | exact human-gate occurrence               | resolution plus complete source-owned value set |

After pipeline and snapshot validation, precedence is:

1. validate command shape, schema, bounds, local duplicates, scalar values, and fields;
2. validate target kind and compiled domains;
3. locate an existing semantic identity;
4. return `unchanged` for exact replay content;
5. return `COMMAND_CONFLICT` for the same identity with different content;
6. validate lifecycle/target state and prospective value ownership;
7. apply and drain.

At step 2, an invalid occurrence, missing/foreign compiled node or domain member, or
wrong compiled node kind is `COMMAND_TARGET`. This target/domain failure precedes
identity replay/conflict and is not a lifecycle failure.

After replay/conflict lookup, new command lifecycle is exact:

| Command               | Target/domain prerequisite | New-command lifecycle requirement | Lifecycle failure                                                         |
| --------------------- | -------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `init`                | N/A; pipeline-level        | snapshot is `uninitialized`       | `COMMAND_STATE`                                                           |
| `taskOutcome`         | exact compiled `task`      | target snapshot node is `enabled` | `COMMAND_STATE` when omitted, retired, terminal, or otherwise not enabled |
| `consensusVerdict`    | exact compiled `consensus` | target snapshot node is `enabled` | `COMMAND_STATE` when omitted, retired, terminal, or otherwise not enabled |
| `humanGateResolution` | exact compiled `humanGate` | target snapshot node is `enabled` | `COMMAND_STATE` when omitted, retired, terminal, or otherwise not enabled |

A foreign occurrence key is `COMMAND_TARGET` before replay lookup. Replay/conflict
therefore outranks later terminal or retired state. Exact replay returns the current
settled snapshot/status and an empty atomic batch even after downstream or terminal
progress.

Each command has at most 128 values. Fact keys MUST be unique within the command,
declared by the compiled pipeline, and have the exact declared scalar type. Values are
canonicalized in declared fact order. The resulting snapshot has at most 128 value
records. Task values are permitted only with outcome `completed`; `failed`, `cancelled`,
and `skipped` require `values: []`. A fact key already owned by another semantic source
is `COMMAND_CONFLICT` even when its scalar value is equal.

Drain applies the compound command, then repeatedly uses private `decideValidated`,
applying activate/select/terminal decisions until wait or terminal. Effects order as:
command effect; decisions in evaluation order; activation targets in compiled topology;
selector completion before its activations; final termination. Each effect corresponds
to exactly one snapshot delta and conversely.

Terminal closure terminalizes the reached node, topology-orders and retires every other
enabled node, emits one `terminatePipeline`, and leaves no enabled node. It is logical
closure only; cancellation, attempts, leases, and external work remain host-owned.

## Bounds and diagnostics

| Item                                          |         Maximum |
| --------------------------------------------- | --------------: |
| snapshot values / command values              |       128 / 128 |
| snapshot nodes / resolutions                  |       256 / 256 |
| snapshot verdicts / combined entries          |   1,024 / 1,664 |
| retirements / decision applications / effects | 255 / 513 / 514 |
| diagnostics                                   |             100 |

Fault phases follow the exact union order above; the diagnostic code is only a sentinel.
Within a phase sort by Unicode code-point path, code, then message. Roots are
`/pipeline`, `/snapshot`, `/command`, and `/reduction`. Decoder faults map to the six
`PIPELINE_*` codes. Paths are at most 1,024 characters and messages at most 512
characters.

The fact-to-snapshot mapping is exact; `SNAPSHOT_SCHEMA` is not a mapped fact fault:

| Existing fact code | Reduction snapshot code |
| ------------------ | ----------------------- |
| `FACT_TYPE`        | `SNAPSHOT_TYPE`         |
| `FACT_LIMIT`       | `SNAPSHOT_LIMIT`        |
| `FACT_DUPLICATE`   | `SNAPSHOT_DUPLICATE`    |
| `FACT_FOREIGN`     | `SNAPSHOT_FOREIGN`      |
| `FACT_OUTCOME`     | `SNAPSHOT_OUTCOME`      |
| `FACT_CANDIDATE`   | `SNAPSHOT_CANDIDATE`    |
| `FACT_RESOLUTION`  | `SNAPSHOT_RESOLUTION`   |
| `FACT_PREMATURE`   | `SNAPSHOT_PREMATURE`    |
| `FACT_CAUSAL`      | `SNAPSHOT_CAUSAL`       |

Overflow is the first 99 faults plus this exact sentinel:

```ts
{
  code: 'REDUCTION_DIAGNOSTIC_LIMIT',
  path: '/reduction/faults',
  message: 'Pipeline reduction diagnostic limit exceeded.'
}
```

Progress beyond 513 applications returns exactly:

```ts
{
  code: 'REDUCTION_STEP_LIMIT',
  path: '/reduction/steps',
  message: 'Pipeline reduction step limit exceeded.'
}
```

Both return no snapshot or batch.

## Hostile inspection

Pipeline, snapshot, and command inspection MUST be descriptor-first, accessor-free for
supported portable values, bounded, mutation-isolated, and staged in type, limit,
schema, reference/domain, graph/causal, then canonical/settledness order. A failed
container stage prunes its descendants; later semantic stages MUST NOT inspect data that
failed an earlier stage.

Arrays first read ordinary `length`. Oversized arrays produce one container limit fault
without own-key reflection or descendant inspection. In-range arrays perform exactly one
`Reflect.ownKeys`; key count MUST equal `length + 1` before descriptor/value inspection,
and keys MUST be exactly `length` plus canonical decimal indices. Sparse arrays,
accessors, symbols, extra properties, and noncanonical indices reject.

Objects perform one own-key reflection. More than 32 reflected keys produce one
container limit fault without descriptor or descendant inspection. Supported values are
ordinary JSON primitives, dense arrays, and plain objects. Custom prototypes,
non-enumerable properties, functions, `undefined`, and fractional, unsafe, or non-finite
numbers reject without invoking accessors. Depth, visited-value, collection, string, and
diagnostic bounds apply before later stages.

Throwing reflection traps are caught at their container and become type faults. A proxy
can execute side effects or fail to terminate inside an ECMAScript trap; no stronger
guarantee is possible. Persisted JSON parsed through `JSON.parse` has no proxy behavior.

## Host CAS obligation and examples

The package does not persist. A stateful host reconstructs one complete settled
snapshot, authorizes one command, reduces, and maps the whole ordered effect batch into
one indivisible host change. It commits no prefix or reordering. On optimistic CAS
conflict it reloads and recomputes the plan, snapshot, command, reduction, batch, host
mapping, and expectations from scratch.

Shipped implementation example:

```ts
const snapshot: PipelineSnapshot = {
  schemaVersion: 1,
  occurrenceKey: 'run-42-pass-1',
  phase: 'uninitialized',
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
  terminal: null,
};
const result = reducePipeline(decoded.pipeline, snapshot, {
  schemaVersion: 1,
  kind: 'init',
  values: initialValues,
});
if (!result.ok) return rejectSemanticCommand(result.faults);
await hostTransaction((tx) => applyWholeBatchWithCas(tx, result.batch, result.snapshot));
```

A separate execution uses a new uninitialized snapshot and key and starts at entry. An
exact replay returns an empty `batch.items`. No example lets the package open a
transaction or implies that an effect batch applies itself.

## Shipped manifest and PR7 verification

The exact new public type manifest is:

```text
CompiledPipelineDecoding
DecodeFault
DecodeFaultCode
PipelineCandidateVerdictRecord
PipelineCommand
PipelineCommandApplication
PipelineEffect
PipelineEffectBatch
PipelineForkRelation
PipelineGateResolutionRecord
PipelineNodeOccurrence
PipelineOccurrenceKey
PipelineReduction
PipelineReductionFault
PipelineReductionFaultCode
PipelineReductionStatus
PipelineRetirement
PipelineSnapshot
PipelineSnapshotNode
PipelineTerminal
PipelineValueRecord
PipelineValueSource
PipelineWait
```

These are exactly 23 unique additions: three decoder types followed by twenty reducer
types, producing 86 root types. The shipped values are exactly `definePipeline`,
`compilePipeline`, `decodeCompiledPipeline`, `decidePipeline`, and `reducePipeline`.

PR7 proved exact signatures and narrowing; all commands and effects; occurrence
isolation and hostile shapes; replay, conflicts, settledness; finite two- and maximum-N
unrolling including fork/join/final-gate/exhaustion behavior; all faults and bounds;
513/514 boundaries; bidirectional effect/snapshot consistency; all node/policy families;
determinism, deep ownership, and no I/O/state/dependency; and exact five-value/86-type
manifests with private seams absent.
