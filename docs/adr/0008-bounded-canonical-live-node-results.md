# ADR 0008: Bounded canonical live node results

- Status: Accepted
- Version: 1.0.0
- Date: 2026-08-12

## Context

Each live machine frame exposes `nodeResults` as exact canonical JSON. A result is
inserted once when its node terminates and remains available to selectors until the
owning frame is pruned. A single region may therefore retain up to the Program node
bound of 4,096 results.

Every transition returns a complete immutable `PipelineState`, and the host checkpoints
that JSON state. A persistent tree, `Map`, hidden mutable index, or process-local cache
would either change the state contract or disappear across serialization. A compiler
liveness index could shorten some result lifetimes but would change Program data and
digests without removing the worst case in which later nodes read earlier results.

## Decision

The external representation remains exactly a frozen, key-sorted
`Readonly<Record<ProgramNodeId, NodeTerminalResult>>`. Unchanged immutable values and
subtrees may be shared between successive states. Results remain owned by their live
frame and are discarded with that frame; they are not run history.

Insertion uses the already canonical key sequence, a binary search for the new full node
ID, one ordinary-object allocation, ordinary property assignment in canonical order,
and one final `Object.freeze`. It never overwrites an existing key. It does not use a
per-entry property descriptor, `Map`, persistent tree, side index, or hidden cache.

For `K` retained results in one live frame, one insertion performs `O(log K)` key
comparisons and `Theta(K)` property assignments. A maximally adversarial sequence is
therefore accepted as `Theta(K^2)` assignments with `K <= 4,096`. This bound is local to
one live frame, not proportional to total run history. The Program bound
`maximumTotalActivities = 1,000,000` must not allocate a million-entry result collection
or any equivalent eager structure.

Hydration preserves the existing two limits: general nested portable objects have at
most 64 keys, while the structural `nodeResults` record alone may contain 4,096 entries.
Hydration accepts only canonical key order and returns an owned frozen JSON graph.

Deterministic verification is primary: reverse insertion of all 4,096 node IDs performs
exactly 8,390,656 assignments and at most `4,096 * 12` comparisons; the final record is
sorted and frozen; duplicate insertion neither replaces nor mutates; a maximum record
hydrates and survives JSON round trip; and the one-million activity bound causes no
eager allocation. Timing checks are secondary guardrails on the reference verification
host: after warm-up, the median of five full insertion runs is at most 5 seconds,
hydration is at most 500 milliseconds, and final-state serialization is at most 50
milliseconds.

## Consequences

- State remains portable, canonical JSON with no second serialized representation.
- Copy cost is explicit, bounded, and measurable at the owning live-frame boundary.
- The implementation stays simple and restart-safe without a custom data structure.
- A future delta-state persistence contract would require a separate architecture
  decision spanning the kernel API and `revo-run`; it is not implied here.

## Relationship to prior decisions

This decision refines ADR 0006. Live node results and operation receipts are pruned with
their execution owners, while `revo-run` remains the durable replay and audit authority.
It does not change ADR 0005's pure-kernel boundary or ADR 0007's initialization identity.
