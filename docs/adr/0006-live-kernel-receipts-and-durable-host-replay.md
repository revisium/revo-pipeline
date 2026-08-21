# ADR 0006: Live kernel receipts and durable host replay

- Status: Accepted
- Version: 1.0.0
- Date: 2026-08-12

## Context

The pure kernel must reject conflicting replies while an operation still belongs to
live machine state. Keeping every resolved operation in `PipelineState` for the full run,
however, makes checkpoints grow with execution history. Repeated immutable state copies
then make long runs progressively more expensive and undermine the one-million-activity
bound.

The durable host already owns run identity, authenticated event history, persistence,
and the outbox. It is therefore the only layer that can provide replay protection after
the kernel has pruned the frame that owned an operation.

## Decision

The kernel owns **live receipts**. An accepted event replaces its pending operation with
exactly `{commandKey, ref, eventDigest}` before applying the result. While that receipt
is live, an identical event is an idempotent no-op and a different digest for the same
command is a conflict. The receipt is pruned only after the result has been copied to its
owner, cancellation acknowledgement sets no longer reference the command, and the
owning frame can be removed.

The host runtime owns replay after pruning. For each accepted semantic event it MUST atomically
persist:

```text
(runId, commandKey) -> eventDigest
+ next PipelineState
+ ordered outbox commands
```

An identical durable receipt is a retry and MUST NOT advance the kernel again. A
different digest for the same `(runId, commandKey)` is a protocol conflict. A crash
before commit leaves the old state and permits retry; a crash after commit reuses the
receipt and outbox without repeating semantic progress.

Kernel command references remain structural and run-agnostic. The host continues to
namespace them by `runId`. Kernel state is live execution state, while the run event and
receipt log is the durable audit and replay authority.

## Consequences

- `PipelineState` stays proportional to live execution rather than total run history.
- Pure transitions remain deterministic, serializable, and independently testable.
- Production exactly-once semantic advancement depends on the host transaction boundary.
- Standalone callers cannot claim replay protection for events whose owning frames were
  already pruned.
- Consumer-readiness evidence must prove the receipt/state/outbox transaction and both
  identical and conflicting post-prune delivery.

## Relationship to ADR 0005

This decision refines ADR 0005's pure-kernel/host boundary. It does not change the
greenfield direct cutover, add a compatibility path, or move live semantic transition
logic out of the kernel.
