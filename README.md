# @revisium/revo-pipeline

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

`definePipeline` preserves literal inference. Compilation produces recursively frozen,
canonical, JSON-compatible graph data. Decisions are synchronous, deterministic, and
pure over the compiled graph and complete supplied fact snapshot.

## Working root example

```ts
import {
  compilePipeline,
  decidePipeline,
  decodeCompiledPipeline,
  definePipeline,
  reducePipeline,
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

const decoding = decodeCompiledPipeline(JSON.parse(JSON.stringify(compilation.pipeline)));
if (!decoding.ok) {
  throw new Error(decoding.faults.map((fault) => fault.message).join('\n'));
}
const pipeline = decoding.pipeline;
const snapshot = {
  schemaVersion: 1 as const,
  occurrenceKey: 'example',
  phase: 'uninitialized' as const,
  values: [] as const,
  nodes: [] as const,
  candidateVerdicts: [] as const,
  gateResolutions: [] as const,
  terminal: null,
};
reducePipeline(pipeline, snapshot, { schemaVersion: 1, kind: 'init', values: [] });
const emptyFacts = { values: [], nodes: [], candidateVerdicts: [], gateResolutions: [] };

decidePipeline(pipeline, emptyFacts);
// { kind: 'activate', cause: { kind: 'entry' }, nodeKeys: ['approval'] }

const unresolvedFacts = {
  ...emptyFacts,
  nodes: [{ key: 'approval', state: 'enabled' as const }],
};
decidePipeline(pipeline, unresolvedFacts);
// { kind: 'wait', nodeKey: 'approval', reason: 'gate-unresolved' }

const resolvedFacts = {
  ...unresolvedFacts,
  gateResolutions: [{ nodeKey: 'approval', resolution: 'approved' }],
};
const first = decidePipeline(pipeline, resolvedFacts);
const repeated = decidePipeline(pipeline, resolvedFacts);
// both: { kind: 'select', nodeKey: 'approval', outcome: 'approved', activate: ['published'] }
```

The package owns graph semantics for `task`, `branch`, `fork`, `join`, `consensus`,
`humanGate`, and `terminal`. Fork/join readiness is derived from declared exit facts;
consensus and gates are derived from supplied verdicts and resolutions. There is no
hidden arrival, vote, gate, or run state.

## Boundary and future integration

This package owns definitions, validation, canonical compilation, graph semantics, and
one decision from facts. A host owns storage, clocks, IDs, attempts, leases, CAS,
retries, resume, authorization, queues, agents, scripts, and atomic application of the
returned decision. `@revisium/revo-run` can consume the public `CompiledPipeline`,
`PipelineFacts`, and `PipelineDecision` types through a one-way dependency.

The diagnostic decoder is the safe boundary for unknown compiled JSON. The pure reducer
inspects hostile snapshot and command inputs, applies or replays one compound command,
and drains deterministic decisions to a wait or terminal without owning persistence.

See the Accepted [definition contract](./docs/specs/pipeline-definition-v1.spec.md),
[transition contract](./docs/specs/pipeline-transition-v1.spec.md),
[decoding target](./docs/specs/pipeline-decoding-v1.spec.md),
[reducer target](./docs/specs/pipeline-reducer-v1.spec.md),
[module DAG](./docs/specs/internal-module-structure.spec.md), and
[executable consumer example](./docs/examples/consumer.md).

## Development

Requires Node.js `>=24.11.1 <25` and pnpm 11.13.0 through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify` covers formatting, strict TypeScript, type-aware linting, unit/coverage and
architecture proof, declarations/build, and one exact packed tarball reused for
contents, publint, ATTW, isolated ESM/strict TypeScript consumers, all 86 public types,
and runtime/type deep-import denial. Publishing, tagging, releasing, or merging requires
separate approval.
