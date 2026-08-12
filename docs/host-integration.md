# Host integration

## Lifecycle

The host contract remains Draft, and this checkout exports no root runtime API. The
private compiler emits the immutable bundle described below and the private base kernel
implements the non-coordination machine slice; complete kernel execution and host
admission remain later work. The flow defines the consumer boundary that complete
conformance evidence must prove.

## Host flow

1. A versioned playbook supplies a validated `PipelineSourcePackage`.
2. A selected profile supplies `ProfileMaterialization`. It selects only an allowed
   `single` or `consensus` strategy for agent slots and abstract participant binding
   keys. Source owns the exact policy, range, remaining behavior, and routes.
3. `compilePipeline(source, materialization)` links calls, rejects recursion, validates
   scope/dataflow/bounds, structurally lowers source, and returns immutable program,
   requirements, provenance, and digests.
4. `revo-core` resolves abstract requirements to exact immutable agent assemblies,
   scripts, effects, tools, permissions, and execution policy. It constructs and
   persists a plan using the contract owned by `revo-run`.
5. `revo-run` validates program, requirements, and provenance, recomputes the digest over
   exactly that bundle, persists the trusted `{program,programDigest}` pair and kernel
   state, and drives durable effects around pure transitions.

The final `./kernel` API described below is not currently exported:

```ts
const kernelProgram = { program: plan.program, programDigest: plan.programDigest };
const initial = createInitialPipelineState(kernelProgram, plan.input);
let state = initial.state;

await checkpointKernelState(state);
await applyCommandsWithDbos(plan, initial.commands);

while (state.status === 'running' || state.status === 'cancelling') {
  const event = await receiveSemanticEvent();
  const transition = advancePipeline(kernelProgram, state, event);

  if (transition.kind === 'rejected') {
    await recordHostProtocolFault(transition.faults);
    continue;
  }

  state = transition.state;
  await checkpointKernelState(state);
  await applyCommandsWithDbos(plan, transition.commands);
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
identity and are unique only within one machine state. `revo-run` namespaces them by
`(runId, commandRef)` and maps them to dynamic workflow, execution, and attempt IDs.

- `dispatchActivity` resolves one plan binding and runs one agent, script, or effect.
- `scheduleWait` maps semantic waiting to DBOS time or durable signal registration.
- `openHumanGate` creates the durable gate/inbox/audit surface and applies host-owned
  authorization and arbitration.
- `cancelPending` cooperatively cancels referenced runtime work.
- Terminal commands settle the run and publish terminal events.

The host returns only semantic events: activity succeeded/failed/cancelled, wait
completed/signal received/cancelled, gate resolved/cancelled, and cancellation
requested. Attempts, retryable error classification, timeout mechanics, reconciliation,
worker leases, and provider responses are not kernel events or state.

## Runtime responsibilities

`revo-run` owns durable delivery, post-prune event deduplication, retries and backoff, attempt and
effect identities, timers, cooperative cancellation, ambiguous-effect reconciliation,
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

The package remains publication-blocked until the exact root and `./kernel` manifests
pass all conformance and consumer-readiness gates. Publication remains a later human
decision.
