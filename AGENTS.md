# Repository Agent Instructions

This repository is the source of `@revisium/revo-pipeline`.

## Source of truth

Read in this order:

1. `README.md` for current work-item and publication status.
2. Accepted ADR 0005 and `docs/architecture.md` for the direct-cutover boundary.
3. The six Draft specifications under `docs/specs/` for work-item constraints.
4. `docs/delivery-plan.md` for sequential scope and spec-section traceability.
5. `docs/host-integration.md` and the intent ownership matrix for consumer boundaries.
6. `REPOSITORY.md`, `VERIFICATION.md`, and `REVIEW.md` for local structure and gates.

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

- `rp-01` is intentionally publication-blocked. Its foundation is private and the root
  module has no runtime exports.
- Do not add an adapter, converter, dual reader, deprecated alias, compatibility
  package, hidden interpreter, or runtime node-kind plugin.
- Implement only the active sequential work item from `rp-00` through `rp-06`.
- Treat `architecture/layers.json` as the layer-activation and dependency source of
  truth. Do not create future layer directories.
- Keep release workflows and public package exports absent until `rp-06` readiness is
  proved and separately approved.

## Change policy

- Architecture or public contract changes require an accepted ADR amendment before
  implementation.
- Add behavior tests at the owning boundary before production behavior.
- Keep production dependencies exactly `typebox@1.3.10` and `canonicalize@3.0.0`; use
  `node:crypto` for SHA-256 and do not add Ajv, XState, or a host dependency.
- Use TypeScript, oxlint, Vitest, dependency-cruiser, build, and audit as ordinary
  contributor checks. Do not add a custom source parser, mutation security framework, or
  duplicated documentation oracle; these gates are not a security sandbox against
  coordinated edits to code and verification.
- Run `corepack pnpm verify` before handoff.
- Do not commit, push, merge, tag, release, or publish without the applicable approval.
