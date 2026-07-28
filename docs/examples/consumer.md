# Consumer Example

The MVP root is implemented but unpublished. This example compiles against the root
package API, and the package verifier executes the same behavior from the exact packed
tarball.

<!-- package-example:expanded-consumer -->

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

// CompiledPipeline is portable data, so storage/transport may JSON-round-trip it.
const serialized: unknown = JSON.parse(JSON.stringify(compilation.pipeline));
const decoding = decodeCompiledPipeline(serialized);
if (!decoding.ok) {
  throw new Error(decoding.faults.map((fault) => fault.message).join('\n'));
}
const pipeline = decoding.pipeline;
const snapshot: PipelineSnapshot = {
  schemaVersion: 1,
  occurrenceKey: 'consumer-example',
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
  initialization.application !== 'applied' ||
  initialization.status !== 'waiting' ||
  initialization.snapshot.phase !== 'active'
) {
  throw new Error('Initialization must produce an active waiting snapshot and ordered batch.');
}
assert.deepEqual(initialization.batch, {
  kind: 'atomic',
  items: [
    { kind: 'initialize', occurrenceKey: 'consumer-example', values: [] },
    {
      kind: 'activateNode',
      occurrence: { occurrenceKey: 'consumer-example', nodeKey: 'approval' },
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
if (decision.kind !== 'wait' || decision.reason !== 'gate-unresolved') {
  throw new Error('The public decision must narrow to the enabled gate wait.');
}

const replay = reducePipeline(pipeline, initialization.snapshot, command);
if (
  !replay.ok ||
  replay.application !== 'unchanged' ||
  replay.status !== 'waiting' ||
  replay.batch.kind !== 'atomic' ||
  replay.batch.items.length !== 0
) {
  throw new Error('Exact replay must preserve the settled wait with an empty atomic batch.');
}
assert.deepEqual(replay.snapshot, initialization.snapshot);
assert.deepEqual(replay.wait, initialization.wait);
```

The seven node kinds have distinct data-only roles:

- `task` selects one declared route from a supplied terminal task outcome.
- `branch` selects a disjoint predicate case or declared default from a supplied value.
- `fork` atomically activates its branch entries and reciprocal join.
- `join` derives readiness and outcome from declared branch-exit facts.
- `consensus` derives a declared outcome from supplied candidate verdicts.
- `humanGate` waits for, then selects, one declared resolution.
- `terminal` reports the declared pipeline outcome.

The package is pure: it does not save the compiled graph or facts and does not apply its
effect batch. A host stores durable state, authorizes facts and commands, applies an
ordered batch, handles conflicts/retries, and supplies a fresh complete snapshot.

A future host can consume the public root. Plan compilation, legacy graph migration,
durable reconstruction, persistence/CAS mapping, and the decision-versus-reducer seam
remain PR9 architecture work; this example does not select any of them.
