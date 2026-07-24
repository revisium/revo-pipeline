# ADR 0001: Portable pipeline language and decision boundary

- Status: Accepted
- Version: 1.0.0
- Date: 2026-07-24

## Context

Pipeline topology, durable run coordination, and executor bindings could become one
stateful subsystem. That would make graph outcomes depend on storage, clocks, attempts,
workers, and application lifecycle, preventing deterministic reuse by different hosts.

## Decision

`@revisium/revo-pipeline` is a portable, zero-runtime-dependency language for graph
definition, deterministic compilation, and pure decisions from explicit facts. Durable
execution and coordination remain outside the package. `@revisium/revo-run` may depend
on pipeline; the reverse dependency is forbidden.

The accepted [definition contract](../specs/pipeline-definition-v1.spec.md) owns the
public vocabulary, compilation rules, graph validity, bounds, and export manifest. The
accepted [transition contract](../specs/pipeline-transition-v1.spec.md) owns facts,
decision precedence, node policies, causal closure, diagnostics, and totality. The
accepted [module contract](../specs/internal-module-structure.spec.md) owns dependency
direction and enforcement. Those specifications are normative; this ADR records only
the boundary rationale.

## Alternatives considered

- A stateful executor was rejected because it would duplicate run ownership and couple
  semantic policy to persistence and worker lifecycle.
- Executable predicates were rejected because code execution would weaken portability
  and deterministic validation.
- Persisted join arrivals were rejected because duplicate delivery and recovery would
  leak run coordination into the semantic package.
- External runtime helpers were rejected for v1 to preserve a small portable package
  boundary.

## Consequences

- Different hosts can reuse one deterministic language without duplicating graph policy.
- Hosts must map durable state into complete fact snapshots and own atomic application,
  conflict retries, cancellation, and unfinished work.
- Canonical compiled data and integrity validation increase payload size and per-decision
  work.
- The intentionally limited v1 language trades expressiveness for a smaller, verifiable
  first contract.
