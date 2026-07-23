<div align="center">

# @revisium/revo-pipeline

**Portable pipeline definitions, deterministic compilation, and pure transition decisions for Revo.**

[![CI](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

> [!IMPORTANT]
> This repository is in bootstrap. The npm package is not published, its root export is intentionally empty, and the API
> below is a Draft target rather than available code. Names and shapes may change before the specifications are accepted.

## About

`@revisium/revo-pipeline` will let a consumer define a portable acyclic graph, compile it into immutable normalized data,
and calculate the next semantic action from explicit facts. It owns task, branch, fork, join, consensus, human-gate, and
terminal graph semantics without running work or storing run state.

```text
PipelineDefinition --compilePipeline--> CompiledPipeline
CompiledPipeline + PipelineFacts --decidePipeline--> PipelineDecision
```

## Quick start

This target-only example defines a small review pipeline and asks for a pure decision. See the
[expanded consumer example](./docs/examples/consumer.md) for branch, fork, join, consensus, and human-gate snapshots.

```ts
import { compilePipeline, decidePipeline, definePipeline } from '@revisium/revo-pipeline';

const definition = definePipeline({
  schemaVersion: 1,
  entry: 'prepare',
  nodes: [
    {
      key: 'prepare',
      kind: 'task',
      outcomes: { completed: 'approval' },
    },
    {
      key: 'approval',
      kind: 'humanGate',
      subject: 'Approve prepared change',
      resolutions: {
        approved: 'published',
        rejected: 'cancelled',
      },
    },
    { key: 'published', kind: 'terminal', outcome: 'published' },
    { key: 'cancelled', kind: 'terminal', outcome: 'cancelled' },
  ],
});

const compilation = compilePipeline(definition);

if (!compilation.ok) {
  throw new Error(compilation.faults.map((fault) => fault.message).join('\n'));
}

const decision = decidePipeline(compilation.pipeline, {
  nodes: [
    { key: 'prepare', state: 'terminal', outcome: 'completed' },
    { key: 'approval', state: 'waiting' },
  ],
  gateResolutions: [{ nodeKey: 'approval', resolution: 'approved' }],
});

// Target decision shape:
// {
//   kind: 'select',
//   nodeKey: 'approval',
//   outcome: 'approved',
//   activate: ['published']
// }
if (decision.kind === 'select') {
  console.log(decision.outcome, decision.activate);
}
```

- `definePipeline()` is a target type helper for portable JSON-compatible definitions; it performs no I/O.
- `compilePipeline()` validates topology and policies, copies retained input, and produces immutable normalized graph data
  or ordered bounded faults.
- `decidePipeline()` is a synchronous pure calculation over a compiled graph and an explicit fact snapshot.
- A decision describes semantic activation, waiting, selection, completion, or invalid facts; it does not mutate or
  persist anything.
- Repeating `decidePipeline()` with deeply equal compiled data and facts produces a deeply equal decision.
- The consumer applies a decision atomically, reloads facts after a conflict, and asks again.

## Complete target API

This is the intended complete root surface for the first accepted slice. Exact supporting types and behavior remain Draft
in the [definition](./docs/specs/pipeline-definition-v1.spec.md) and
[transition](./docs/specs/pipeline-transition-v1.spec.md) specifications.

```ts
export declare function definePipeline<const TDefinition extends PipelineDefinition>(
  definition: TDefinition,
): TDefinition;

export declare function compilePipeline(definition: PipelineDefinition): PipelineCompilation;

export declare function decidePipeline(
  pipeline: CompiledPipeline,
  facts: PipelineFacts,
): PipelineDecision;

export type PipelineCompilation =
  | { readonly ok: true; readonly pipeline: CompiledPipeline }
  | { readonly ok: false; readonly faults: readonly DefinitionFault[] };

export type PipelineDecision =
  | { readonly kind: 'activate'; readonly nodeKeys: readonly NodeKey[] }
  | {
      readonly kind: 'select';
      readonly nodeKey: NodeKey;
      readonly outcome: string;
      readonly activate: readonly NodeKey[];
    }
  | { readonly kind: 'wait'; readonly nodeKey: NodeKey; readonly reason: string }
  | { readonly kind: 'terminal'; readonly outcome: string }
  | { readonly kind: 'reject'; readonly faults: readonly DecisionFault[] };
```

`PipelineDefinition`, `CompiledPipeline`, `PipelineFacts`, node contracts, policies, faults, and decision variants will be
readonly exported types. The declarations above are a provisional API sketch, not a shipped or accepted contract.

## Responsibility boundary

The package owns:

- portable readonly pipeline definitions and bounded deterministic validation;
- immutable normalized compiled topology, indexes, and semantic policies;
- pure branch selection and fork activation;
- join readiness derived from supplied branch/node facts, without arrival records;
- deterministic consensus evaluation over normalized candidate verdict facts;
- human-gate outcome selection from a supplied accepted resolution fact;
- stable decision and diagnostic ordering.

The consumer owns:

- durable runs, runtime node instances, attempts, outputs, events, ids, timestamps, and versions;
- atomic decision application, CAS, fencing, leases, retry scheduling, resume, duplicate delivery, and recovery;
- agent/script execution, model/profile/prompt/workspace/provider bindings, and immutable host `ExecutionPlan` creation;
- persistence, queues, authorization, human inboxes, notifications, costs, product verdicts, and API adapters.

`@revisium/revo-run` may depend on this package to calculate semantic decisions. This package must never depend on
`@revisium/revo-run`, Prisma, DBOS, queue libraries, agents, scripts, or host frameworks.

## Documentation

- [Expanded consumer example](./docs/examples/consumer.md) — one coherent target graph with representative fact snapshots
  and decisions.
- [Pipeline definition v1](./docs/specs/pipeline-definition-v1.spec.md) — Draft portable graph and compilation contract.
- [Pipeline transition v1](./docs/specs/pipeline-transition-v1.spec.md) — Draft facts, decisions, and evaluation rules.
- [Internal module structure](./docs/specs/internal-module-structure.spec.md) — Draft layering and dependency rules.
- [Architecture](./docs/architecture.md) — semantic ownership and package boundary.
- [Documentation index](./docs/README.md) — ADRs, policies, and specifications.
- [Testing](./docs/testing.md) — proof layers and required implementation coverage.

## Requirements

- Node.js 24 (`>=24.11.1 <25`)
- pnpm 11.13.0 through Corepack
- Docker only for the local SonarCloud parity check

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

| Command                    | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `pnpm format:check`        | Verify formatting                                          |
| `pnpm typecheck`           | Run strict TypeScript diagnostics                          |
| `pnpm lint`                | Run type-aware Oxlint                                      |
| `pnpm test`                | Run unit and package tests                                 |
| `pnpm test:architecture`   | Prove the allowed graph and representative violations      |
| `pnpm test:cov`            | Run tests with v8 coverage                                 |
| `pnpm build`               | Build ESM JavaScript and TypeScript declarations           |
| `pnpm verify:package`      | Validate the exact tarball, types, ESM, and denied imports |
| `pnpm verify:architecture` | Run the committed architecture verification harness        |
| `pnpm verify`              | Run the complete local CI gate                             |
| `pnpm ci:local:sonar`      | Verify, analyze with Sonar, and inspect open branch issues |

## SonarCloud

Copy `.env.sonar.example` to an ignored `.env.sonar`, provide `SONAR_TOKEN`, and run `pnpm ci:local:sonar`. Alternatively,
set `SONAR_ENV_FILE=/absolute/path/to/.env.sonar`. CI runs verification before analysis; pull requests also wait for the
Quality Gate and fail when open Sonar issues remain.

## Package contract

The package is ESM-only, uses explicit exports, emits declarations, and ships only `dist`, `README.md`, `LICENSE`, and
package metadata. The bootstrap root remains exactly `export {};` until an accepted public slice is implemented, tested,
and proven through the packed consumer harness.

## License

[MIT](LICENSE) © Revisium
