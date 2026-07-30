<div align="center">

# @revisium/revo-pipeline

**Portable pipeline definitions, deterministic compilation, and pure transitions for Revo.**

[![CI](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Pre-release package. It is not published to npm; the API remains under review.

## About

`@revisium/revo-pipeline` owns readonly pipeline definitions, deterministic compilation,
canonical decoding, pure semantic decisions, and pure command reduction. It has no runtime dependencies
(zero) and performs no I/O.

The host owns runs, persistence, transactions, compare-and-swap, clocks, retries,
authorization, agents, scripts, and effect application.

## Installation

After a version is published:

```bash
corepack pnpm add @revisium/revo-pipeline
```

Requires Node.js `>=24.11.1 <25`. The package is strict ESM and supports named imports
from its root only.

## Quick start

<!-- package-example:start:task-branch-terminal -->

```ts
import {
  compilePipeline,
  decidePipeline,
  decodeCompiledPipeline,
  definePipeline,
  reducePipeline,
  type PipelineSnapshot,
} from '@revisium/revo-pipeline';

const definition = definePipeline({
  schemaVersion: 1,
  entry: 'work',
  facts: [],
  nodes: [
    {
      kind: 'task',
      key: 'work',
      outcomes: {
        completed: 'done',
        failed: 'done',
        cancelled: 'done',
        skipped: 'done',
      },
    },
    { kind: 'terminal', key: 'done', outcome: 'done' },
  ],
});

const compilation = compilePipeline(definition);
if (!compilation.ok) throw new Error(compilation.faults[0]?.code);

const decoding = decodeCompiledPipeline(JSON.parse(JSON.stringify(compilation.pipeline)));
if (!decoding.ok) throw new Error(decoding.faults[0]?.code);

const facts = { values: [], nodes: [], candidateVerdicts: [], gateResolutions: [] };
console.log(decidePipeline(decoding.pipeline, facts));

const initial: PipelineSnapshot = {
  schemaVersion: 1,
  occurrenceKey: 'example',
  phase: 'uninitialized',
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
  terminal: null,
};
console.log(
  reducePipeline(decoding.pipeline, initial, { schemaVersion: 1, kind: 'init', values: [] }),
);
```

<!-- package-example:end:task-branch-terminal -->

## Complete public API

```ts
export declare function definePipeline<const Definition extends PipelineDefinition>(
  definition: Definition,
): Definition;

export declare function compilePipeline(definition: PipelineDefinition): PipelineCompilation;

export declare function decodeCompiledPipeline(input: unknown): CompiledPipelineDecoding;

export declare function decidePipeline(
  pipeline: CompiledPipeline,
  facts: PipelineFacts,
): PipelineDecision;

export declare function reducePipeline(
  pipeline: CompiledPipeline,
  snapshot: PipelineSnapshot,
  command: PipelineCommand,
): PipelineReduction;
```

Narrow compiler, decoder, and reducer results by `ok`. Narrow decisions by `kind`.
Use `reducePipeline` for a durable host's command-to-settled-state seam. Exact types,
faults, ordering, bounds, and semantics live in the accepted specifications.

## Documentation

- [Architecture](docs/architecture.md)
- [Host integration](docs/host-integration.md)
- [Accepted specifications](docs/specs/)
- [Architecture decisions](docs/adr/)
- [Repository map](REPOSITORY.md)
- [Verification](VERIFICATION.md)

## Development

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

Publishing, tagging, releasing, and merging require separate approval.
