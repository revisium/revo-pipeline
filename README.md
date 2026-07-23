# @revisium/revo-pipeline

Portable pipeline definition, compilation, and transition semantics for Revo.

This repository is currently a **package foundation**. The npm package deliberately
exports nothing while the contracts in [`docs/specs`](./docs/specs/README.md) are
Draft. Examples in Draft specifications describe the intended API; they are not
executable or shipped.

## Intended responsibility

`@revisium/revo-pipeline` will own:

- a portable `PipelineDefinition`;
- deterministic validation and compilation into a portable `CompiledPipeline`;
- pure `PipelineFacts -> PipelineDecision` transition evaluation;
- branch, fork, join, consensus, and human-gate graph semantics.

It will not own run identifiers, clocks, attempts, leases, persistence, compare-and-set
operations, retry scheduling, resume mechanics, host-specific `ExecutionPlan` bindings,
agents, scripts, Prisma, DBOS, queues, NestJS, GraphQL, MCP, or CLI behavior.

The intended flow is:

```text
PipelineDefinition --compile--> CompiledPipeline
CompiledPipeline + PipelineFacts --decide--> PipelineDecision
```

The consuming orchestrator turns a portable `CompiledPipeline` into its immutable
host-specific `ExecutionPlan`. `@revisium/revo-run` persists run state and applies
durable state changes; it may depend on this package, while this package must never
depend on `@revisium/revo-run`.

## Repository status

- Shipped public API: intentionally empty.
- Production dependencies: none.
- Draft contracts: definition, transition, and internal module structure.
- Toolchain: Node.js 24.11.1, pnpm 11.13.0, strict TypeScript 7, ESM, Vitest 4,
  Oxlint, Oxfmt, `publint`, and Are The Types Wrong.

## Development

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

See [`VERIFICATION.md`](./VERIFICATION.md), [`docs/architecture.md`](./docs/architecture.md),
and [`docs/testing.md`](./docs/testing.md). Publication is governed by
[`docs/release-train.md`](./docs/release-train.md) and always requires separate approval.
