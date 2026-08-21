# Repository Agent Instructions

This repository is the source of the under-development `@revisium/revo-pipeline`
package.

## Source of truth

Read `README.md`, accepted ADRs, the six Draft specifications, `docs/architecture.md`,
`docs/host-integration.md`, and then the repository verification/review overlays.

## Boundary

The package owns source contracts, materialization validation, compilation, graph
semantics, canonical Program data, digests, and pure machine transitions. It does not
own persistence, attempts, leases, clocks, DBOS workflows, retries, binding resolution,
authorization, subscriptions, or host frameworks. Do not add `revo-run`, Prisma, DBOS,
queues, NestJS, GraphQL, MCP, CLI, or provider SDK dependencies.

The only consumer entrypoints are `@revisium/revo-pipeline`,
`@revisium/revo-pipeline/kernel`, and the ADR 0013
`@revisium/revo-pipeline/revo-run` bridge, with the exact manifests in Pipeline
Conformance v1. Do not add other deep exports, wildcard barrels, default or CommonJS
exports, adapters, deprecated aliases, dual readers, hidden interpreters, or runtime
node-kind plugins.

Keep production dependencies exactly `typebox@1.3.10` and `canonicalize@4.0.0`. The
under-development package may be published only as an unstable prerelease under the npm
`alpha` tag. This does not establish compatibility or `revo-core`/`revo-run` readiness.
Release automation may validate or prepare future versions. Automated npm publication
is restricted to an explicit, version-matched alpha tag and never runs for pull requests.

## Changes

- Inspect existing implementation and tests before editing; use CodeGraph first when
  `.codegraph/` exists.
- Public contract changes require an accepted ADR amendment.
- Add behavior tests at the owning boundary.
- Preserve the six-layer DAG in `architecture/layers.json` and keep `src/extensions`
  absent.
- Run `corepack pnpm verify` before handoff.
- Do not commit, push, merge, tag, release, or publish without the applicable approval.
