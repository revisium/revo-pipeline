# Host integration

## Lifecycle

The host contract remains Draft. Npm `alpha` prereleases and local or CI-built tarballs
expose the exact compiler and kernel facades for consumer evaluation, without a
compatibility or host-readiness guarantee. Host-owned run admission and durability remain
outside this package.

## Host flow

1. `revo-core` passes raw versioned `PipelineSourcePackage` and profile data to
   `revo-run`; it does not compile a pipeline or arbitrate a run.
2. `revo-run` derives `PipelineSelections` from that profile. The record is keyed by the
   globally unique source agent-node ID; selections choose only an allowed `single` or
   `consensus` strategy and abstract participant binding keys. Source owns the exact
   policy, range, remaining behavior, and routes.
3. `revo-run` calls `compilePipeline(source, selections)` internally. It links calls,
   rejects recursion, validates scope/dataflow/bounds, structurally lowers source, and
   receives immutable program, requirements, provenance, and digests.
4. `revo-run` resolves abstract requirements to exact immutable agent assemblies,
   scripts, tools, permissions, and execution policy through its composition. Durable
   run records remain host-runtime contracts.
5. `revo-run` validates the compiler bundle, persists the trusted
   `{program,programDigest}` pair and kernel state, and drives durable host actions
   around pure transitions.

The `./kernel` API is used as follows:

```ts
const kernelProgram = { program: run.program, programDigest: run.programDigest };
const initial = createInitialPipelineState(kernelProgram, run.input);
let state = initial.state;

await checkpointKernelState(state);
await applyCommandsWithDbos(run.composition, initial.commands);

while (state.status === 'running' || state.status === 'cancelling') {
  const event = await receiveSemanticEvent();
  const transition = advancePipeline(kernelProgram, state, event);

  if (transition.kind === 'rejected') {
    await recordHostProtocolFault(transition.faults);
    continue;
  }

  state = transition.state;
  await checkpointKernelState(state);
  await applyCommandsWithDbos(run.composition, transition.commands);
}
```

For an accepted semantic event, the host atomically commits its durable
`(runId,commandKey) -> eventDigest` receipt, the next kernel state, and the ordered
outbox commands. A repeated event with the same durable digest does not invoke the
kernel again; a different digest for the same key is a protocol conflict. A crash before
commit retries from the old state, while a crash after commit resumes from the persisted
receipt, state, and outbox. The host must also preserve causation between each structural
command reference and its returned semantic event.
Admission, not the kernel, validates and hashes the complete compiler bundle. Invalid
initial input produces a failed state and fail command; a program-digest mismatch rejects
advancement with unchanged state and no commands.

## Command application

The kernel may emit `dispatchActivity`, `scheduleWait`, `openHumanGate`,
`cancelPending`, `complete`, `fail`, or `cancel`. Command references contain no run
identity and are unique only within one machine state. The host runtime namespaces them by
`(runId, commandRef)` and maps them to dynamic workflow, execution, and attempt IDs.

- `dispatchActivity` resolves one `revo-run` composition binding and runs one agent or script.
- `scheduleWait` maps semantic waiting to DBOS time or durable signal registration.
- `openHumanGate` creates the durable gate/inbox/audit surface from its subject, answer,
  authorization, payload-schema, and optional deadline fields; authorization remains
  host-owned.
- `cancelPending` cooperatively cancels referenced runtime work.
- Terminal commands settle the run and publish terminal events.

The host returns only semantic events: activity succeeded/failed/cancelled, wait
completed/signal received/cancelled, gate resolved/cancelled, and cancellation
requested. Attempts, retryable error classification, timeout mechanics, reconciliation,
worker leases, and provider responses are not kernel events or state.

## Runtime responsibilities

The host runtime owns durable delivery, post-prune event deduplication, retries and backoff, attempt and
host-action identities, timers, cooperative cancellation, ambiguous-action reconciliation,
DBOS lifecycle, global capacity, projections, event cursors, and subscriptions. The
kernel owns deterministic semantic progress, early parallel decisions, drain/cancel
intent and acknowledgements, map-local concurrency, structural references, and terminal
outcome selection.

Votes are explicit successful activity outputs: `approve`, `reject`, or `abstain`.
Activity failure is never a vote. Each frame owns immutable scope input and exact
terminal results. Child completion copies into the parent before live frames and their
receipts are pruned; the run receipt/event/attempt log remains the durable replay and
audit authority.

Run and region cancellation are nonterminal until all pending work acknowledges.
Independent sibling regions may have concurrent cancellation sets. Once run
cancellation is selected, no new region cancellation begins. Duplicate or late
acknowledgements are idempotent, and no terminal state retains detached work.

## Direct-cutover rule

No adapter, converter, dual-read mode, compatibility alias, deprecated bridge, hidden
interpreter, or preservation layer is allowed. The 103-row ownership matrix preserves
semantic intent through 54 pipeline-evidence and 49 host/cross-package evidence
obligations; it does not preserve data structures or request 103 pipeline
implementations.

The package remains under development, Draft, and unstable even when published under
the npm `alpha` tag. Publication does not claim that `revo-core` or the host runtime is ready
and does not change the pipeline package API or its digests.
