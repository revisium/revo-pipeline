# Repository Agent Instructions

This repository is the source of `@revisium/revo-pipeline`.

## Source of truth

Read in this order:

1. `README.md` for reset and publication status.
2. Accepted ADR 0005 and `docs/architecture.md` for the direct-cutover boundary.
3. The six Draft specifications under `docs/specs/` for work-item constraints.
4. `docs/host-integration.md` and the intent ownership matrix for consumer boundaries.
5. `REPOSITORY.md`, `VERIFICATION.md`, and `REVIEW.md` for local structure and gates.

The six specifications remain Draft through `rp-06`. Do not expose a Draft API from
`src/index.ts` or add the final root or `./kernel` package exports before `rp-06`.

## Non-negotiable boundary

Keep this package pure and portable. It owns source contracts, materialization
validation, compilation, graph semantics, canonical program data, digests, and pure
machine transitions. It does not own run state persistence, attempts, leases, clocks,
DBOS workflows, retries, binding resolution, authorization, subscriptions, or host
frameworks. Never add `@revisium/revo-run`, Prisma, DBOS, a queue, NestJS, GraphQL, MCP,
or CLI dependencies.

## Direct-cutover policy

- The reset is intentionally publication-blocked and has no runtime exports.
- Do not add an adapter, converter, dual reader, deprecated alias, compatibility
  package, hidden interpreter, or runtime node-kind plugin.
- Implement only the active sequential work item from `rp-00` through `rp-06`.
- Keep release workflows and public package exports absent until `rp-06` readiness is
  proved and separately approved.

## Change policy

- Architecture or public contract changes require an accepted ADR amendment before
  implementation.
- Add behavior tests at the owning boundary before production behavior.
- Run `corepack pnpm verify` before handoff.
- Do not commit, push, merge, tag, release, or publish without the applicable approval.
