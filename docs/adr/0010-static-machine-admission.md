# ADR 0010: Static Machine admission

- Status: Accepted
- Version: 1.1.1
- Date: 2026-08-13

## Context

A source package can satisfy the source-node bound yet expand during deterministic
lowering into a larger Program. Structured repeat, map, parallel, cancellation, and
copy-up behavior can also produce more synchronous work or live canonical state than a
single pure transition can safely own. Rejecting such a Program only when the kernel
starts would permit the compiler to emit an unusable bundle and digest.

## Decision

The compiler admits only lowered Programs whose structural size, deterministic work to
the next host boundary, live semantic state, cancellation memberships, serialized state
values, and command values fit the fixed Machine v1 caps. The kernel applies the same
Program analysis as a corruption guard and counts the same runtime work units.
`PipelineState` remains complete canonical JSON; the design adds no host yield protocol,
hidden cache, or million-activity allocation.

Admission occurs after lowering and before requirements, provenance bundle emission, or
`programDigest`. It returns one deterministic `BOUND_EXCEEDED` diagnostic at the first
contributing source path. The shared analysis is frontier-aware: a pending child removes
only that child from the current worklist, while runnable siblings, map refill, result
copy-up, and cleanup continue in the same transition.

The fixed caps are 4,096 Program nodes, 4,096 Program regions, 16,384 targets, nesting
and call depth 32, 65,536 synchronous work units, 16,384 live frames, 16,384 live
operations, 65,536 total live node results, 262,144 structural collection slots, 65,536
cancellation memberships, and 1,048,576 JSON value occurrences in state or commands.
Strings count as one JSON value; this decision does not establish a serialized-byte
limit for an otherwise valid unbounded string.

Each transition builds at most one transient reverse cancellation index from the
canonical sets and memberships. It is neither serialized nor retained. Runtime overflow
after successful admission is an invariant failure guard, not a cooperative-yield path.

Map owners persist only the minimal inverse relation needed for bounded refill:
`itemSourceIndexes` aligns original selected-array indexes with canonical Unicode-sorted
`itemKeys`. Hydration requires equal lengths and an exact permutation of `0..N-1`.
Runtime finds a key by binary search and directly addresses its source item; it does not
rescan all keys, rebuild complete preflight, or retain a hidden descriptor index across
transitions. A map owner is charged `5N+4` structural collection slots. Let `O` be the
maximum schema weight of a completed body exit and `R=max(7,4+O)`; its conservative
map-local JSON envelope is `15+N*(4+R)`, with saturating arithmetic. The scalar-output
specialization is `11N+15`. The final retained author projection is separately weighted
as `2+N*(4+max(1,O))`. Runtime counts actual canonical state occurrences once before
returning a transition.

## Consequences

- The compiler cannot publish a bundle that the kernel rejects for the same fixed caps.
- Parallel frontier work and overlapping cancellation memberships are charged rather
  than hidden behind one child boundary.
- Analysis may conservatively reject a boundary case, but accepted programs require no
  scheduler checkpoint inside a pure transition.
- Larger state or work envelopes require a versioned architecture decision.

## Relationship to prior decisions

This decision refines ADR 0005's pure kernel, ADR 0006's live receipt ownership, and ADR
0008's bounded canonical results. It does not change host persistence or replay
ownership.
