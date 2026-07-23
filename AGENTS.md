# Repository Agent Instructions

This repository is the source of `@revisium/revo-pipeline`.

## Source of truth

Read in this order:

1. `README.md` for package status and consumer intent.
2. `docs/architecture.md` and accepted ADRs for ownership boundaries.
3. Accepted specifications under `docs/specs/` for implementable behavior.
4. `REPOSITORY.md` for structure and dependency direction.
5. `VERIFICATION.md` and `REVIEW.md` for completion gates.

Draft specifications describe targets, not shipped behavior. Do not expose a Draft API
from `src/index.ts`.

## Non-negotiable boundary

Keep this package pure and portable. It owns definitions, compilation, graph semantics,
and pure decisions. It does not own run state, attempts, leases, clocks, persistence,
CAS, retry scheduling, resume, `ExecutionPlan` bindings, agents, scripts, or host
frameworks. Never add `@revisium/revo-run`, Prisma, DBOS, queue, NestJS, GraphQL, MCP,
or CLI dependencies.

## Change policy

- Architecture or public API changes require an accepted ADR/spec before implementation.
- Add behavior tests at the owning boundary before production behavior.
- Maintain the layer matrix and exact negative probes.
- Run `corepack pnpm verify` before handoff.
- Do not commit, push, merge, tag, release, or publish without the applicable approval.
