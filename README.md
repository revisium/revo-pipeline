# @revisium/revo-pipeline

Portable pipeline definitions, deterministic compilation, and pure semantic decisions
for Revo.

> [!IMPORTANT]
> The v1 contract is accepted, but no runtime API is shipped. The package is unpublished
> and `src/index.ts` is exactly `export {};`. The API below is a planned declaration for
> later implementation slices, not an importable API today.

```text
PipelineDefinition --compilePipeline--> CompiledPipeline
CompiledPipeline + PipelineFacts --decidePipeline--> PipelineDecision
```

The planned root surface is `definePipeline`, `compilePipeline`, `decidePipeline`, and
their readonly definition, compiled graph, facts, policy, fault, and decision types.
`definePipeline` is identity/type inference only. Compilation is bounded and creates
frozen canonical portable data; decisions are synchronous, pure, deterministic, and
total over supplied facts.

The package owns graph semantics for task, branch, fork, join, consensus, human gate,
and terminal nodes. It excludes runs, attempts, IDs, time, persistence, CAS, leases,
retries, resume, queues, authorization, agent/script execution, and host bindings.
Join readiness uses declared exit-node facts, never `JoinArrival`; branch predicates are
disjoint, never first-match; v1 forbids nested forks.

See the accepted [definition contract](./docs/specs/pipeline-definition-v1.spec.md),
[transition contract](./docs/specs/pipeline-transition-v1.spec.md),
[module DAG](./docs/specs/internal-module-structure.spec.md), and planned
[consumer example](./docs/examples/consumer.md).

## Development

Requires Node.js `>=24.11.1 <25` and pnpm 11.13.0 through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify` runs formatting, strict type checking, type-aware linting, tooling/package
tests and coverage, architecture probes, ESM declarations/build, publint, and the exact
packed-consumer proof. Do not publish, tag, release, merge, or add a root export without
the separately approved implementation and release path.
