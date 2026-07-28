# @revisium/revo-pipeline

[![CI](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml)
[![Sonar quality gate](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![Sonar coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Portable pipeline definitions, deterministic compilation, pure semantic decisions, and
pure snapshot reduction for Revo.

The MVP root API is implemented and package-ready, but this `0.0.0` package is not
published. It exports exactly `definePipeline`, `compilePipeline`, `decidePipeline`,
`decodeCompiledPipeline`, `reducePipeline`, and
the 86 Accepted readonly contract types, including safe unknown-JSON decoding. No default export, alias, subpath,
policy helper, graph helper, or runtime dependency is public.

```text
PipelineDefinition --compilePipeline--> CompiledPipeline
unknown JSON --decodeCompiledPipeline--> CompiledPipelineDecoding
CompiledPipeline + PipelineFacts --decidePipeline--> PipelineDecision
CompiledPipeline + PipelineSnapshot + PipelineCommand --reducePipeline--> PipelineReduction
```

`definePipeline` preserves literal inference. Every callable is synchronous,
deterministic, state-free, non-mutating, and performs no I/O. Successful compiler,
decoder, and reducer results are package-owned immutable data. Compilation, decoding,
and reduction can fail: narrow their discriminated `ok` result before reading `pipeline`
or `faults`. Decisions narrow by `kind`.

| Value                    | Input role                                       | Result role                           |
| ------------------------ | ------------------------------------------------ | ------------------------------------- |
| `definePipeline`         | readonly definition literal                      | same literal with preserved inference |
| `compilePipeline`        | `PipelineDefinition`                             | `PipelineCompilation`                 |
| `decodeCompiledPipeline` | `unknown` serialized data                        | `CompiledPipelineDecoding`            |
| `decidePipeline`         | compiled pipeline plus complete facts            | `PipelineDecision`                    |
| `reducePipeline`         | compiled pipeline, settled snapshot, one command | `PipelineReduction`                   |

This is one ESM-only public root with zero runtime dependencies. The type groups belong
to the Accepted [definition](./docs/specs/pipeline-definition-v1.spec.md),
[transition](./docs/specs/pipeline-transition-v1.spec.md),
[decoding](./docs/specs/pipeline-decoding-v1.spec.md), and
[reducer](./docs/specs/pipeline-reducer-v1.spec.md) contracts.

## Working root example

<!-- package-example:readme-working-root -->

```ts
import assert from 'node:assert/strict';
import {
  compilePipeline,
  decidePipeline,
  decodeCompiledPipeline,
  definePipeline,
  reducePipeline,
  type PipelineFacts,
  type PipelineSnapshot,
} from '@revisium/revo-pipeline';

const definition = definePipeline({
  schemaVersion: 1,
  entry: 'approval',
  facts: [],
  nodes: [
    {
      kind: 'humanGate',
      key: 'approval',
      subject: 'Approve the change',
      resolutions: [
        { resolution: 'approved', to: 'published' },
        { resolution: 'rejected', to: 'cancelled' },
      ],
    },
    { kind: 'terminal', key: 'published', outcome: 'published' },
    { kind: 'terminal', key: 'cancelled', outcome: 'cancelled' },
  ],
});

const compilation = compilePipeline(definition);
if (!compilation.ok) {
  throw new Error(compilation.faults.map((fault) => fault.message).join('\n'));
}

const serialized: unknown = JSON.parse(JSON.stringify(compilation.pipeline));
const decoding = decodeCompiledPipeline(serialized);
if (!decoding.ok) {
  throw new Error(decoding.faults.map((fault) => fault.message).join('\n'));
}
const pipeline = decoding.pipeline;
const snapshot: PipelineSnapshot = {
  schemaVersion: 1,
  occurrenceKey: 'example',
  phase: 'uninitialized',
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
  terminal: null,
};
const command = { schemaVersion: 1 as const, kind: 'init' as const, values: [] };
const initialization = reducePipeline(pipeline, snapshot, command);
if (!initialization.ok) {
  throw new Error(initialization.faults.map((fault) => fault.message).join('\n'));
}
if (
  initialization.status !== 'waiting' ||
  initialization.application !== 'applied' ||
  initialization.snapshot.phase !== 'active'
) {
  throw new Error('Expected initialization to wait after applying its command.');
}
const settled = initialization.snapshot;
assert.deepEqual(initialization.batch, {
  kind: 'atomic',
  items: [
    { kind: 'initialize', occurrenceKey: 'example', values: [] },
    {
      kind: 'activateNode',
      occurrence: { occurrenceKey: 'example', nodeKey: 'approval' },
      cause: { kind: 'entry' },
      fork: { kind: 'none' },
    },
  ],
});

const facts: PipelineFacts = {
  values: [],
  nodes: [{ key: 'approval', state: 'enabled' }],
  candidateVerdicts: [],
  gateResolutions: [],
};
const decision = decidePipeline(pipeline, facts);
if (decision.kind !== 'wait') {
  throw new Error('Expected the enabled gate to await a resolution.');
}

const replay = reducePipeline(pipeline, settled, command);
if (!replay.ok || replay.application !== 'unchanged' || replay.status !== 'waiting') {
  throw new Error('Expected an exact replay to preserve the settled snapshot.');
}
assert.deepEqual(replay.snapshot, settled);
assert.deepEqual(replay.wait, initialization.wait);
if (replay.batch.kind !== 'atomic' || replay.batch.items.length !== 0) {
  throw new Error('Expected an exact replay to emit an empty atomic batch.');
}
```

The package owns graph semantics for `task`, `branch`, `fork`, `join`, `consensus`,
`humanGate`, and `terminal`. Fork/join readiness is derived from declared exit facts;
consensus and gates are derived from supplied verdicts and resolutions. There is no
hidden arrival, vote, gate, or run state.

## Boundary and future integration

This package owns definitions, validation, canonical compilation, graph semantics, and
pure decisions/reductions from supplied data. A host owns storage, clocks, IDs, attempts,
leases, CAS, retries, resume, authorization, queues, agents, scripts, and application of
returned effects. A future host can consume the public root through a one-way dependency;
this package does not claim compatibility with any legacy orchestrator or persistence model.

The diagnostic decoder is the safe boundary for unknown compiled JSON. The pure reducer
inspects hostile snapshot and command inputs, applies or replays one compound command,
and drains deterministic decisions to a wait or terminal without owning persistence.

See the Accepted [definition contract](./docs/specs/pipeline-definition-v1.spec.md),
[transition contract](./docs/specs/pipeline-transition-v1.spec.md),
[decoding contract](./docs/specs/pipeline-decoding-v1.spec.md),
[reducer contract](./docs/specs/pipeline-reducer-v1.spec.md),
[module DAG](./docs/specs/internal-module-structure.spec.md), and
[executable consumer example](./docs/examples/consumer.md).

## Development

Requires Node.js `>=24.11.1 <25` and pnpm 11.13.0 through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify` covers formatting, strict TypeScript, type-aware linting, every discovered test
exactly once across the architecture harness and product coverage routes, complete
`src`-only LCOV, direct architecture proof, declarations/build, and one exact packed
tarball reused for contents, publint, ATTW, isolated ESM/strict TypeScript consumers, all
86 public types, and runtime/type deep-import denial. Publishing, tagging, releasing, or
merging requires separate approval.
