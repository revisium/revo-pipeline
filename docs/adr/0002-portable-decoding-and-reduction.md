# ADR 0002: Portable Decoding and Pure Reduction

- Status: Accepted
- Date: 2026-07-27

## Context

Compiled pipelines cross an untrusted JSON boundary, while a stateful host must turn
semantic occurrences into durable changes without moving persistence or runtime identity
into this package. The existing `decidePipeline` API intentionally computes one decision
from complete facts and remains compatible.

## Decision

Add two synchronous root operations in separate implementation slices:

- `decodeCompiledPipeline(input)` diagnostically verifies canonical compiled v1 data and
  returns a newly owned, deeply frozen copy.
- `reducePipeline(pipeline, snapshot, command)` applies one compound semantic occurrence
  to one settled immutable snapshot, drains pure decisions to wait or terminal, and
  returns a newly owned snapshot plus one ordered atomic effect batch.

The package owns portable contracts, inspection, graph semantics, and pure reduction.
The host owns occurrence-key allocation, authorization, runtime identity, persistence,
transactions, revisions, fences, retries, and terminal-state mapping. A host applies a
successful batch whole and in order. After a compare-and-set conflict it reloads all
authoritative state and recomputes; it never reuses an abandoned result or batch prefix.

One occurrence key identifies one complete traversal from the DAG entry. Interior
bounded rework is represented by finite, forward-only graph unrolling with distinct node
keys, not by a new occurrence or node reactivation.

## Alternatives rejected

- `createPipeline` and mutable sessions imply retained package state.
- An opaque decoded handle or cache sacrifices portable JSON identity.
- A generic command batch or standalone value command loses semantic provenance and
  compound atomicity.
- Pipeline-owned storage or CAS reverses the dependency boundary.
- Reducer `quiescent` success would admit an unsettled finite-v1 snapshot.

## Consequences

The public target grows after PR7 from three values and 63 types to five values and 86
types. PR6 implements decoding; PR7 implements reduction and the private shared decision
seam. Until then these are Accepted targets, not shipped exports. Consumer-specific
schemas and transaction technology require a separate architecture decision.
