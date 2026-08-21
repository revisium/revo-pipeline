# ADR 0011: Under-development package entrypoints

- Status: Accepted
- Amends: ADR 0005

## Context

The pipeline library can be evaluated as a standalone package before its consumers are
finished. Keeping its implemented API unreachable prevents realistic package-boundary
testing and does not improve the contracts themselves.

## Decision

The exact root and kernel manifests in Pipeline Conformance v1 are available for local
and CI consumer evaluation while the contracts remain Draft. Package readiness is
assessed independently from `revo-core` and host-runtime integration. The direct-cutover
and no-compatibility decisions in ADR 0005 remain unchanged.

## Alternatives Considered

- Keep the implemented API unreachable until every consumer is complete.
- Evaluate only internal source modules instead of the package boundary.

## Consequences

Real consumers can test the same curated boundary they are expected to use. The accepted
downside is that users of a Draft API may need to update their code as the contracts
change.
