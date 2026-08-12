# Pipeline Machine v1

- Status: Draft
- Version: 1.0.0-draft
- Target package: `@revisium/revo-pipeline/kernel`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

## Scope and exact functions

This specification defines the final pure machine API. It remains Draft and unavailable
from the package root while conformance is incomplete. TypeBox schemas are authoritative
and every object rejects unknown fields.

```ts
type KernelProgram = {
  readonly program: PipelineProgram;
  readonly programDigest: Digest;
};

declare function createInitialPipelineState(
  bundle: KernelProgram,
  input: JsonValue,
): InitialPipelineTransition;

declare function advancePipeline(
  bundle: KernelProgram,
  state: PipelineState,
  event: PipelineEvent,
): PipelineTransition;

type InitialPipelineTransition = {
  readonly kind: 'initialized';
  readonly state: PipelineState;
  readonly commands: readonly PipelineCommand[];
};

type PipelineTransition =
  | {
      readonly kind: 'advanced';
      readonly state: PipelineState;
      readonly commands: readonly PipelineCommand[];
    }
  | {
      readonly kind: 'rejected';
      readonly state: PipelineState;
      readonly commands: readonly [];
      readonly faults: readonly [MachineFault, ...MachineFault[]];
    };
```

Both functions MUST be synchronous, deterministic, side-effect-free, and total for
portable inputs. They MUST NOT mutate arguments, perform I/O, observe a clock, generate
an ID, use randomness, persist, call DBOS, resolve a binding, or retain hidden state.

`KernelProgram` is a trusted admission product. Before either function is called,
`revo-core`/`revo-run` MUST validate all schemas and recompute the full compiler-bundle
digest over exactly `{program,requirements,provenance}`. The kernel MUST NOT repeat that
bundle validation or digest computation. During advancement it only compares the
provided `programDigest` to the state pin. `PipelineState` is likewise trusted state:
the host MUST hydrate it only from an authenticated initial transition and event log;
the kernel's invariant checks are corruption guards, not an untrusted-state verifier.

## Structural frame identities and command references

```ts
type FrameKeyPayload =
  | {
      readonly kind: 'initialization';
      readonly parentFrameKey: null;
      readonly programDigest: Digest | null;
    }
  | {
      readonly kind: 'rootRegion';
      readonly parentFrameKey: null;
      readonly regionId: ProgramNodeId;
    }
  | {
      readonly kind: 'call';
      readonly parentFrameKey: Digest;
      readonly nodeId: ProgramNodeId;
    }
  | {
      readonly kind: 'callRegion';
      readonly parentFrameKey: Digest;
      readonly regionId: ProgramNodeId;
    }
  | {
      readonly kind: 'parallel';
      readonly parentFrameKey: Digest;
      readonly nodeId: ProgramNodeId;
    }
  | {
      readonly kind: 'parallelBranch';
      readonly parentFrameKey: Digest;
      readonly regionId: ProgramNodeId;
      readonly branchKey: string;
    }
  | {
      readonly kind: 'repeat';
      readonly parentFrameKey: Digest;
      readonly nodeId: ProgramNodeId;
    }
  | {
      readonly kind: 'repeatBody';
      readonly parentFrameKey: Digest;
      readonly regionId: ProgramNodeId;
      readonly ordinal: number;
    }
  | {
      readonly kind: 'map';
      readonly parentFrameKey: Digest;
      readonly nodeId: ProgramNodeId;
    }
  | {
      readonly kind: 'mapItem';
      readonly parentFrameKey: Digest;
      readonly regionId: ProgramNodeId;
      readonly itemKey: string;
    };

type CommandRef = {
  readonly programDigest: Digest;
  readonly frameKey: Digest;
  readonly nodeId: ProgramNodeId | '$pipeline';
};
type CommandKey = Digest;
```

Every structural key is the Canonicalization v1 digest in domain `pipeline-frame-key/v1`
over exactly one `FrameKeyPayload`. The `initialization` variant is the pre-root causal
anchor used only for `PROGRAM_INVALID`; it is never executable and never appears in
`PipelineState.frames`. Its `programDigest` is an own lexically valid candidate or
`null`. `null` is the root/pre-root parent sentinel. The repeat
body ordinal is the zero-based iteration number. Other structured nodes execute at most
once in one enclosing region frame and therefore need no activation counter. A branch
key or item key is canonical source data, not an encoded path. The payload has no
`runId` or `RunKey`.

`CommandRef` is unique only within one machine state. The host MUST namespace delivery,
idempotency, and storage by `(runId, commandRef)`; cross-run equality is expected and is
not a collision. `CommandKey` is the complete Canonicalization v1 SHA-256 digest in
domain `pipeline-command-key/v1` over exactly `{kind,ref}`. No truncation is allowed.

## Exact terminal results and state envelope

```ts
type NodeTerminalResult =
  | { readonly status: 'succeeded'; readonly output: JsonValue }
  | { readonly status: 'failed'; readonly failure: PipelineFailure }
  | { readonly status: 'cancelled' };
type RegionTerminalResult =
  | {
      readonly status: 'succeeded';
      readonly outcome: string;
      readonly output: JsonValue;
    }
  | { readonly status: 'failed'; readonly failure: PipelineFailure }
  | { readonly status: 'cancelled' };

type MachineFrameBase = {
  readonly key: Digest;
  readonly parentFrameKey: Digest | null;
  readonly scopeInput: JsonValue;
  readonly nodeResults: Readonly<Record<ProgramNodeId, NodeTerminalResult>>;
};

type RegionExecutionState = {
  readonly regionId: ProgramNodeId;
  readonly status: 'active' | 'draining' | 'cancelling' | 'completed';
  readonly ready: readonly ProgramNodeId[];
  readonly selectedExit: { readonly outcome: string; readonly output: JsonValue } | null;
};
type RootRegionMachineFrame = MachineFrameBase &
  RegionExecutionState & {
    readonly kind: 'rootRegion';
    readonly parentFrameKey: null;
  };
type CallRegionMachineFrame = MachineFrameBase &
  RegionExecutionState & {
    readonly kind: 'callRegion';
    readonly parentFrameKey: Digest;
  };
type ParallelBranchMachineFrame = MachineFrameBase &
  RegionExecutionState & {
    readonly kind: 'parallelBranch';
    readonly parentFrameKey: Digest;
    readonly branchKey: string;
  };
type RepeatBodyMachineFrame = MachineFrameBase &
  RegionExecutionState & {
    readonly kind: 'repeatBody';
    readonly parentFrameKey: Digest;
    readonly ordinal: number;
  };
type MapItemMachineFrame = MachineFrameBase &
  RegionExecutionState & {
    readonly kind: 'mapItem';
    readonly parentFrameKey: Digest;
    readonly itemKey: string;
  };
type RegionMachineFrame =
  | RootRegionMachineFrame
  | CallRegionMachineFrame
  | ParallelBranchMachineFrame
  | RepeatBodyMachineFrame
  | MapItemMachineFrame;

type CallMachineFrame = MachineFrameBase & {
  readonly kind: 'call';
  readonly parentFrameKey: Digest;
  readonly nodeId: ProgramNodeId;
  readonly childRegionKey: Digest | null;
  readonly childResult: RegionTerminalResult | null;
  readonly status: 'active' | 'completed';
};

type ParallelMachineFrameBase = MachineFrameBase & {
  readonly kind: 'parallel';
  readonly parentFrameKey: Digest;
  readonly nodeId: ProgramNodeId;
  readonly branchRegionKeys: Readonly<Record<string, Digest>>;
  readonly status: 'active' | 'draining' | 'cancelling' | 'completed';
};
type GenericParallelMachineFrame = ParallelMachineFrameBase & {
  readonly mode: 'generic';
  readonly branchResults: Readonly<Record<string, GenericParallelBranchResult>>;
  readonly selected: 'completed' | 'impossible' | 'failed' | 'cancelled' | null;
};
type VoteParallelMachineFrame = ParallelMachineFrameBase & {
  readonly mode: 'votes';
  readonly branchResults: Readonly<Record<string, VoteParallelBranchResult>>;
  readonly selected:
    'approved' | 'rejected' | 'inconclusive' | 'participantFailed' | 'cancelled' | null;
};
type ParallelMachineFrame = GenericParallelMachineFrame | VoteParallelMachineFrame;

type RepeatMachineFrame = MachineFrameBase & {
  readonly kind: 'repeat';
  readonly parentFrameKey: Digest;
  readonly nodeId: ProgramNodeId;
  readonly iteration: number;
  readonly bodyRegionKey: Digest | null;
  readonly bodyResult: RegionTerminalResult | null;
  readonly previousOutput: JsonValue | null;
  readonly status: 'active' | 'completed';
};

type MapItemResult = {
  readonly itemKey: string;
  readonly status: 'succeeded' | 'failed' | 'cancelled';
  readonly output: JsonValue | null;
  readonly failure: PipelineFailure | null;
};
type MapMachineFrame = MachineFrameBase & {
  readonly kind: 'map';
  readonly parentFrameKey: Digest;
  readonly nodeId: ProgramNodeId;
  readonly itemKeys: readonly string[];
  readonly pendingItemKeys: readonly string[];
  readonly activeItemKeys: readonly string[];
  readonly completedItems: readonly MapItemResult[];
  readonly status: 'active' | 'draining' | 'cancelling' | 'completed';
  readonly selected: 'completed' | 'failed' | 'cancelled' | null;
};

type MachineFrame =
  | RegionMachineFrame
  | CallMachineFrame
  | ParallelMachineFrame
  | RepeatMachineFrame
  | MapMachineFrame;

type PendingOperation =
  | {
      readonly kind: 'activity';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
      readonly requirementKey: string;
    }
  | {
      readonly kind: 'wait';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
      readonly waitKind: 'duration' | 'signal';
    }
  | {
      readonly kind: 'humanGate';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
    };

type ResolvedOperation = {
  readonly commandKey: CommandKey;
  readonly ref: CommandRef;
  readonly eventDigest: Digest;
};

type RunCancellation = {
  readonly reasonCode: string;
  readonly awaiting: readonly CommandKey[];
};
type RegionCancellation = {
  readonly frameKey: Digest;
  readonly reasonCode: string;
  readonly awaiting: readonly CommandKey[];
};

type PipelineState = {
  readonly schemaVersion: 'pipeline-state/v1';
  readonly programDigest: Digest;
  readonly status: 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';
  readonly input: JsonValue;
  readonly frames: readonly MachineFrame[];
  readonly pending: readonly PendingOperation[];
  readonly resolved: readonly ResolvedOperation[];
  readonly runCancellation: RunCancellation | null;
  readonly regionCancellations: readonly RegionCancellation[];
  readonly result: { readonly outcome: string; readonly output: JsonValue } | null;
  readonly fault: PipelineFailure | null;
};
```

`scopeInput` is immutable for the frame lifetime. `nodeResults` is keyed only by full
`ProgramNodeId`; succeeded, failed, and cancelled use the one exact envelope above.
It has no entry before a result-producing node terminates, gains exactly one entry when
that node terminates, and never overwrites it. Control-only `choice` and `end` nodes do
not add placeholder results. Properties sort by node ID. A succeeded selector sees only
`output`. The exact `failure` is visible only through `nodeFailure` on a statically
dominated failure route. Cancelled has no payload selector.

`nodeResults` remains an exact frozen JSON record until its owning frame is pruned.
Unchanged frozen result values may be shared between states. Insertion uses binary key
positioning, one ordinary-object allocation, ordinary property assignment in canonical
order, and one final freeze; it has no `Map`, persistent tree, hidden cache, or side
index. For `K <= 4,096` retained results in one live frame, one insertion is
`Theta(K)` assignments and `O(log K)` comparisons. The accepted `Theta(K^2)` maximum
sequence is bounded to that live frame and never to total run history. In particular,
`maximumTotalActivities = 1,000,000` causes no eager result allocation. General nested
portable objects remain capped at 64 keys; only structural `nodeResults` uses the 4,096
Program-node bound. See ADR 0008.

All arrays and records are canonical: frames by key, pending/resolved and cancellation
acknowledgements by command key, region cancellations by frame key, ready by node ID,
branches by branch key, and item lists/results by item key. State MUST NOT contain
workflow/provider/database IDs, attempts, leases, retry counters, deadlines, timestamps,
DBOS handles, cursors, actor sessions, authorization results, executors, or secrets.

`resolved` contains live receipts, not the run's event history. An accepted operation
event removes the matching pending operation and inserts its exact
`{commandKey,ref,eventDigest}` receipt before applying the result. The receipt remains
while its owner or a cancellation acknowledgement set can still reference the command.
It is pruned only after the result has been copied to its owner, every containing
cancellation set has acknowledged it, and the owning frame is pruned. Durable replay
after that point is the `revo-run` responsibility defined in the Host boundary below.

## Exact event union

```ts
type PipelineEvent =
  | {
      readonly kind: 'activitySucceeded';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
      readonly output: JsonValue;
    }
  | {
      readonly kind: 'activityFailed';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
      readonly errorCode: string;
    }
  | {
      readonly kind: 'activityCancelled';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
    }
  | {
      readonly kind: 'waitCompleted';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
    }
  | {
      readonly kind: 'signalReceived';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
      readonly signal: string;
      readonly payload: JsonValue | null;
    }
  | {
      readonly kind: 'waitCancelled';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
    }
  | {
      readonly kind: 'gateResolved';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
      readonly resolution:
        | { readonly kind: 'answer'; readonly answer: string; readonly actorRef: string }
        | { readonly kind: 'conflict' }
        | { readonly kind: 'deadline' };
    }
  | {
      readonly kind: 'gateCancelled';
      readonly commandKey: CommandKey;
      readonly ref: CommandRef;
    }
  | { readonly kind: 'cancelRequested'; readonly reasonCode: string };
```

Activity terminal statuses are represented only by the three activity event kinds.
Custom domain results belong in `activitySucceeded.output`. Any executor outcome/status
field or unknown activity result kind is `EVENT_EXECUTOR_OUTCOME` and rejects the event
without changing state.

An accepted `activityFailed` event MUST atomically store the exact node result
`{status:'failed',failure:{code:event.errorCode,path:''}}` before following the
activity's failed route. It MUST NOT discard the result, use an executor-supplied path,
or expose the failure route before `nodeFailure` can read the retained object.

The host authenticates/authorizes/arbitrates before `gateResolved`. Answer carries audit
attribution; conflict/deadline are explicit host decisions. `gateCancelled` is not a
gate resolution.

An event must match pending `commandKey`, ref, and kind. An identical replay, determined
by domain `pipeline-event/v1` digest, is idempotent. A conflicting replay, foreign ref,
wrong operation kind, undeclared answer/signal, or invalid event schema returns
`kind:'rejected'`, the identical state object, no commands, and stable EVENT faults.

## Exact command union and order

```ts
type PipelineCommand =
  | {
      readonly kind: 'cancelPending';
      readonly key: CommandKey;
      readonly ref: CommandRef;
      readonly targets: readonly [CommandKey, ...CommandKey[]];
      readonly reasonCode: string;
    }
  | {
      readonly kind: 'dispatchActivity';
      readonly key: CommandKey;
      readonly ref: CommandRef;
      readonly requirementKey: string;
      readonly input: JsonValue;
      readonly outputSchema: ValueSchema;
    }
  | {
      readonly kind: 'scheduleWait';
      readonly key: CommandKey;
      readonly ref: CommandRef;
      readonly wait:
        | { readonly kind: 'duration'; readonly durationMs: number }
        | {
            readonly kind: 'signal';
            readonly signal: string;
            readonly payloadSchema: ValueSchema | null;
          };
    }
  | {
      readonly kind: 'openHumanGate';
      readonly key: CommandKey;
      readonly ref: CommandRef;
      readonly subject: string;
      readonly answers: readonly [string, ...string[]];
      readonly authorizationRequirements: readonly string[];
    }
  | {
      readonly kind: 'complete';
      readonly key: CommandKey;
      readonly ref: CommandRef;
      readonly outcome: string;
      readonly output: JsonValue;
    }
  | {
      readonly kind: 'fail';
      readonly key: CommandKey;
      readonly ref: CommandRef;
      readonly code: string;
      readonly path: JsonPointer;
    }
  | {
      readonly kind: 'cancel';
      readonly key: CommandKey;
      readonly ref: CommandRef;
      readonly reasonCode: string;
    };
```

Command priority is exactly: `cancelPending` 0, `dispatchActivity` 10, `scheduleWait`
20, `openHumanGate` 30, `complete` 90, `fail` 91, `cancel` 92. Arrays sort by numeric
priority, then RFC 8785 UTF-8 bytes of `ref`, then `key`. `targets` sort by key. A
terminal command therefore follows cancellation intent in the same transition.

Commands contain no dynamic IDs, attempts, retry delays, absolute timestamps, DBOS
names, providers/models, resolved secrets, cursors, or persistence instructions.

## Initialization, data, frames, and advancement

Initialization validates the trusted program shape and top-module input schema before
entry. Invalid module input MUST return a failed state plus one `fail` command with
`INIT_INPUT_SCHEMA`; it MUST NOT throw. Invalid trusted program shape similarly returns
`PROGRAM_INVALID`; the kernel does not recompute compiler-bundle integrity. In
particular, a pre-A3 vote branch with no required `input` field is invalid Program IR
and MUST NOT be inferred as an empty or identity mapping. A vote participant region that
does not have the exact A3 input/output schemas, one activity, three routed ends, fixed
exits, and identity mapping is also `PROGRAM_INVALID`; the kernel never repairs an older
lowering shape. Core/run compiler-bundle admission additionally validates the generated
IDs and provenance, which are intentionally absent from `KernelProgram`.
A Program human gate whose answer vocabulary and answer routes are not unique equal
Unicode-keyed sets is likewise `PROGRAM_INVALID` during initialization.

For `PROGRAM_INVALID`, rejected input is normalized to `null`, no live frame is created,
and exactly one `fail` command uses the `initialization` structural key. The failed
state's and reference's effective `programDigest` is the own lexical candidate when
present, otherwise that pre-root key; the reference node is `$pipeline`. For
`INIT_INPUT_SCHEMA`, rejected input is also `null`, but the valid Program supplies its
admitted `programDigest` and actual root-region key. No zero, random, or synthetic
executable-frame digest is permitted.

`advancePipeline` MUST first compare `bundle.programDigest` with
`state.programDigest`. A mismatch returns `kind:'rejected'` with exactly
`PROGRAM_DIGEST_MISMATCH`, the identical state object, and no commands. It MUST NOT hash
the bundle or reinterpret state with a different program.

Runtime selector evaluation uses own-property RFC 6901 traversal. A missing pointer
fails the owning node with `DATA_POINTER_MISSING`. Before creating any child frame, the
kernel constructs the entire child `scopeInput` from the declared mapping and validates
it against the child region's exact `inputSchema`. For call, repeat, or map, a mapping or
schema failure produces the owning node's failed terminal result and declared failure
route. For a generic or vote parallel branch, it produces that branch's failed result
before aggregate policy classification. No failed child frame is created, no command is
emitted for it, no exception is thrown, and unrelated siblings follow the structured
node's remaining-work policy.

Every region exit selected through a `failed` classification MUST validate its value
against exact `PipelineFailureValueSchema`, including semantic `JsonPointer` validation
of `path`. A malformed object becomes the owning node result
`{status:'failed',failure:{code:'DATA_SCHEMA_MISMATCH',path:''}}`. A valid object is
copied byte-for-byte semantically (the same `code` and `path`, with no wrapping or
rewriting) through generic branch, vote branch, repeat, call, map, and final failure
propagation. `nodeFailure` reads that retained object.

Vote-parallel activation MUST evaluate every branch input in canonical branch-key order
before it classifies the accumulated results or dispatches participant activities. A
missing selector stores `{status:'failed',failure:{code:'DATA_POINTER_MISSING',path}}`;
an incompatible constructed input stores
`{status:'failed',failure:{code:'DATA_SCHEMA_MISMATCH',path}}`. The failing branch has no
`branchRegionKeys` entry and emits no activity command. Each successful mapping creates
one branch frame whose `scopeInput` is the constructed object; the participant activity
then consumes only the compiler-emitted identity mapping from that scope.

`branchRegionKeys` contains a branch key if and only if that branch currently has a live
child frame. A pre-frame failure never adds one. A terminal child atomically copies its
result into `branchResults`, removes its live-key entry, and is pruned. `branchResults`
contains only terminal branches while execution is active and exactly every declared
branch at completion; neither record uses null or placeholder entries.

If a pre-frame vote failure selects `participantFailed`, `remaining:'drain'` starts or
continues every successfully constructed sibling and waits for its real terminal result.
`remaining:'cancel'` requests cancellation for already dispatched siblings and locally
marks successfully constructed but not dispatched siblings cancelled without emitting
their activity command. In both modes classification remains `participantFailed`, and
the vote parallel cannot exit until its result record is total.

After applying a valid event, the machine saturates deterministic choice, call,
structured-region, mapping, and end progress. Activity, wait, and gate nodes emit their
one external command. The same logical operation MUST NOT emit twice.

A completed structured owner frame MUST first copy its one terminal result under the
owner's full node ID into the enclosing region frame's `nodeResults`, then unlink and
prune itself and every completed descendant. An inner branch/item/body/call-region exit
first copies into the owner's exact branch/item/body/call field; it never invents a
synthetic node ID. The final owner copy and prune are atomic in the returned immutable
state. While the operation receipt remains live, replay reads `resolved` and cannot
recreate the child. After receipt pruning, `revo-run`'s durable receipt and event log is
the replay and audit authority; machine frames are live execution state, not durable
audit history. A frame may be
pruned only after it has no pending descendant and its exact result has been copied to
its owning or enclosing parent.

Map activates at most `maximumConcurrency` local item frames/dispatches. This is a
kernel-owned map-local bound. `revo-run` separately owns plan-wide/global capacity and
may durably queue valid dispatch commands. Repeat true at the final bound selects
`exhausted`; no invariant fault is allowed.

A failed map item retains its exact failure in `MapItemResult.failure`, with
`output:null`; succeeded and cancelled items have `failure:null`. The compiler-derived
author map output keeps its existing `errorCode` field and derives it as `failure.code`
only for a failed item. It never stores only `errorCode` in machine state or loses the
failure path. A fail-fast map propagates the selected full failure object.

Generic parallel `branchResults` becomes the total `GenericParallelOutput.branches`
record; vote parallel uses the total `VoteParallelOutput.votes` record. Early policy
selection does not finish the node: drain/cancel MUST eventually write exactly one
terminal entry for every declared branch before the parallel result is copied up.

When multiple failures arise during one deterministic saturation step, the lowest
canonical branch key, item key, or full node ID selects the propagated failure. Failures
delivered by separate host events are ordered by accepted event causality: the first
event selects, while later cleanup results are retained where required but cannot
replace the selected failure.

## Concurrent cancellation and acknowledgement

Run cancellation and region cleanup are separate state dimensions. `cancelRequested`
atomically selects `runCancellation`, changes a running state to `cancelling`, records
all pending keys in its `awaiting`, and emits at most one `cancelPending`. Once
`runCancellation` is non-null, the kernel MUST NOT create a new `regionCancellation`;
existing region sets remain and their acknowledgements also reduce the run set.

Every structured owner using `remaining:'cancel'` creates or updates exactly one
`regionCancellation` keyed by its owning frame and containing all pending descendants.
Independent sibling owners MAY have concurrent cancellation sets. An acknowledgement
removes its command key from every containing set in one transition. `drain` selects a
result but creates no cancellation set and waits for ordinary terminal results.

An operation that succeeds or fails after a cancellation request acknowledges cleanup
and retains that real terminal result; it cannot replace an already selected aggregate
classification. A cleanup cancellation writes a cancelled branch/item result. Run
`cancel` MUST NOT be emitted until `runCancellation.awaiting` and every
`regionCancellation.awaiting` are empty. `complete` and `fail` have the same no-detached
work requirement.

Repeated cancellation requests, duplicate acknowledgements, and acknowledgements that
arrive after their cancellation set was removed are idempotent: they return the exact
same state object and no commands. A conflicting replay remains an EVENT rejection.
Run success/failure/cancellation is immutable after terminal. No terminal transition may
retain a pending operation, cancellation awaiting key, or live child frame.

## Stable fault families

```ts
type MachineFaultFamily = 'PROGRAM' | 'INIT' | 'EVENT' | 'DATA' | 'INVARIANT';
type MachineFault = {
  readonly family: MachineFaultFamily;
  readonly code: string;
  readonly path: JsonPointer;
  readonly message: string;
};
```

Required stable codes are `PROGRAM_INVALID`, `PROGRAM_DIGEST_MISMATCH`,
`INIT_INPUT_SCHEMA`, `EVENT_SCHEMA`, `EVENT_FOREIGN`, `EVENT_CONFLICT`,
`EVENT_OPERATION_KIND`, `EVENT_EXECUTOR_OUTCOME`, `EVENT_SIGNAL`, `EVENT_GATE_ANSWER`,
`DATA_POINTER_MISSING`, `DATA_SCHEMA_MISMATCH`, and `INVARIANT_PROGRAM_STATE`.
Rejected transitions use PROGRAM/EVENT faults. INIT/DATA/INVARIANT faults fail the
owning node or state as defined above and never throw. Messages are fixed, bounded, and
value-redacted.

## Host boundary

`revo-run` owns durable state/outbox, the authenticated event/attempt history, command
delivery, run-scoped namespaces, dynamic IDs, attempts, retry and timeout policy,
reconciliation, DBOS workflows, global capacity, timers, authorization, subscriptions,
and projections. The kernel does not poll or re-emit a pending command because no event
arrived.

For every accepted semantic event, `revo-run` MUST atomically persist the durable
`(runId,commandKey) -> eventDigest` receipt, the next `PipelineState`, and the ordered
outbox commands. A post-prune event with the same digest is an idempotent retry and MUST
NOT invoke the kernel again; a different digest for the same key is a protocol conflict.
A crash before commit leaves the prior state eligible for retry, while a crash after
commit reuses the persisted receipt and outbox. This durable transaction is required for
production replay safety and is outside the pure kernel.
