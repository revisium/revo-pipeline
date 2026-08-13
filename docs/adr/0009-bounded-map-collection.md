# ADR 0009: Bounded map collection

- Status: Accepted
- Version: 1.0.0
- Date: 2026-08-12

## Context

Pipeline v1 represents runtime collections as portable JSON arrays. That representation
has a fixed 1,024-item bound, while the earlier map declaration allowed a larger number
that could never be supplied through the same contract. Creating item work before the
complete collection is checked would also make failure order depend on local concurrency.

## Decision

Pipeline v1 limits map input and map-local concurrency to 1,024 items, matching the only
portable array representation accepted by v1. Larger maps require a separately versioned
collection contract. Map activation validates the complete selected collection before
creating item work.

The empty map remains valid with `maximumItems: 0` and `maximumConcurrency: 1`. For
every non-empty declaration, `maximumConcurrency <= maximumItems`. Runtime item keys and
mapped child inputs are validated for the whole selected array in deterministic input-index
and mapping-key order. A preflight failure creates no owner frame, item frame, pending
operation, or command.

## Consequences

- Map declarations and Program nodes use one attainable bound.
- Duplicate or malformed later items cannot leave earlier item work detached.
- Map-local concurrency remains distinct from host-owned global capacity.
- Supporting larger collections requires a new versioned representation rather than an
  implicit exception to portable JSON.

## Relationship to prior decisions

This decision refines ADR 0005's bounded closed language and ADR 0008's explicit live
state bounds. It does not expose a new API or move scheduling into the host.
