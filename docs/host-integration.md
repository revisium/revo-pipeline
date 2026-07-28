# Host integration

The package is a pure semantic component. A host owns serialized plans, settled
snapshots, revision guards, transactions, authorization, persistence, IDs, clocks,
inboxes, retries, and applying effects.

```text
repeat transaction attempt:
  load complete authoritative input and aggregate revision/revision vector
  decode the serialized compiled JSON
  if decoding fails:
    call no projection, reducer, mapping, or application path
    perform no authoritative transition write or revision advance
    abort/roll back this transition attempt
    return stable decode fault codes and paths to host policy
  project one complete settled snapshot
  host-authorize external input and construct exactly one portable command
  reduce exactly once
  if reduction fails:
    call no mapping or application path
    perform no authoritative transition write or revision advance
    abort/roll back this transition attempt
    return stable reduction fault codes and paths to host policy
  map the entire ordered batch and next snapshot as one indivisible host change
  commit only if the complete loaded revision guard still matches
  if compare-and-swap conflicts:
    discard decoded pipeline, projection, command, reduction, batch, mapping,
    expectations, and every derived/generated identifier
    reload, decode, reproject, reauthorize, reconstruct, reduce, and remap
    from the beginning
  otherwise return waiting or terminal to host policy
```

Compare-and-swap means “apply only if stored revisions still equal those read.” The
guard is either one aggregate opaque revision or an atomically compared exact vector.
It covers the serialized compiled bytes/identity and schema version; every
authoritative record projected into the snapshot phase, values, node occurrences and
outcomes, candidate verdicts, gate resolutions, and terminal state; every command
authorization input and accepted external value; and every authoritative expectation
used to map the next snapshot and effects. The stored authoritative projection after a
successful commit must exactly represent the returned next snapshot and whole ordered
batch under that same guard. Never apply a batch prefix, reorder it, or reuse any
decoded/projected/authorized/constructed/reduced/mapped value after conflict.
`PipelineEffectBatch` is data; it cannot apply itself.

Decode or reduction failure ends the transition attempt. If policy chooses quarantine,
plan replacement, incident creation, or operator recovery, that is a separately
initiated, authorized, concurrency-guarded host action using freshly loaded data. It is
not a pipeline effect and reuses nothing from the aborted attempt.

For human gates, the package validates portable shape, bounds, occurrence, target kind,
declared resolution/value domains, lifecycle/causality, replay/conflict, value
canonicalization, deterministic routing, and bounded diagnostics. The host first
authenticates, authorizes, and accepts external input, then constructs the command.
Identity, eligibility, inbox presentation, durable answer/audit storage, concurrent
submission CAS, notification, timeout, escalation, and retry policy stay host-owned.
