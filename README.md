<div align="center">

# @revisium/revo-pipeline

**Portable pipeline definitions, deterministic compilation, and pure decisions for Revo.**

[![CI](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Pre-release package. The API remains under review.

## About

`@revisium/revo-pipeline` is a pure pipeline graph kernel: readonly pipeline
definitions, author-input validation, deterministic compilation, and pure
semantic decisions. It has no runtime dependencies (zero) and performs no I/O.

The host owns runs, durable execution, persistence, retries, authorization,
agents, scripts, and effect application. The host feeds facts in; the kernel
answers with one decision at a time.

## Installation

```bash
corepack pnpm add @revisium/revo-pipeline
```

Requires Node.js `>=24.11.1 <25`. The package is strict ESM and supports named imports
from its root only.

## Quick start

```ts
import { compilePipeline, decidePipeline, definePipeline } from '@revisium/revo-pipeline';

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

const facts = { values: [], nodes: [], candidateVerdicts: [], gateResolutions: [] };
console.log(decidePipeline(compilation.pipeline, facts));
// { kind: 'activate', cause: { kind: 'entry' }, nodeKeys: ['work'] }
```

The host records each new fact (a task outcome, a consensus verdict, a gate
resolution) and calls `decidePipeline` again. Decisions are pure: the same
pipeline and the same facts always produce the same decision, which makes the
kernel safe to drive from a deterministic-replay engine.

`compilePipeline` output is canonical JSON data. Persist it with a digest pin
and hand it back to `decidePipeline` as-is; the kernel treats the compiled
pipeline as trusted input produced by its own compiler.

Script nodes pin an exact script identity and portable JSON input. A successful
compilation also exposes the host-owned execution template:

```ts
const scriptCompilation = compilePipeline(
  definePipeline({
    schemaVersion: 1,
    entry: 'echo',
    facts: [],
    nodes: [
      {
        kind: 'script',
        key: 'echo',
        script: { id: 'script:system/echo', version: 1 },
        input: { message: 'Hello' },
        outcomes: { completed: 'done', failed: 'done', cancelled: 'done', skipped: 'done' },
      },
      { kind: 'terminal', key: 'done', outcome: 'succeeded' },
    ],
  }),
);
if (scriptCompilation.ok) console.log(scriptCompilation.template.executorRequirements);
```

Compilation lowers each script node to a task in `compilation.pipeline`, while
`compilation.template` references that same pipeline and carries only unresolved
host requirements. This package does not resolve or execute scripts. Task-only
definitions and pipeline consumers do not need to adopt the template.

## Complete public API

```ts
export declare function definePipeline<const Definition extends PipelineDefinition>(
  definition: Definition,
): Definition;

export declare function compilePipeline(definition: PipelineDefinition): PipelineCompilation;

export declare function decidePipeline(
  pipeline: CompiledPipeline,
  facts: PipelineFacts,
): PipelineDecision;
```

Narrow compiler results by `ok`. Narrow decisions by `kind`. Exact types,
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
