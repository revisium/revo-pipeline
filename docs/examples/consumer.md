# Consumer Example

The MVP root is implemented but unpublished. This example compiles against the root
package API, and the package verifier executes the same behavior from the exact packed
tarball.

```ts
import {
  compilePipeline,
  decidePipeline,
  definePipeline,
  type PipelineFacts,
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
const pipeline = JSON.parse(JSON.stringify(compilation.pipeline));
const emptyFacts: PipelineFacts = {
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
};

const activateEntry = decidePipeline(pipeline, emptyFacts);
// { kind: 'activate', cause: { kind: 'entry' }, nodeKeys: ['approval'] }

const unresolvedFacts: PipelineFacts = {
  ...emptyFacts,
  nodes: [{ key: 'approval', state: 'enabled' }],
};
const waitForGate = decidePipeline(pipeline, unresolvedFacts);
// { kind: 'wait', nodeKey: 'approval', reason: 'gate-unresolved' }

const resolvedFacts: PipelineFacts = {
  ...unresolvedFacts,
  gateResolutions: [{ nodeKey: 'approval', resolution: 'approved' }],
};
const selectDeclaredRoute = decidePipeline(pipeline, resolvedFacts);
// { kind: 'select', nodeKey: 'approval', outcome: 'approved', activate: ['published'] }

const deterministicRepeat = decidePipeline(pipeline, resolvedFacts);
// deterministicRepeat is deeply equal to selectDeclaredRoute.

void activateEntry;
void waitForGate;
void deterministicRepeat;
```

The seven node kinds have distinct data-only roles:

- `task` selects one declared route from a supplied terminal task outcome.
- `branch` selects a disjoint predicate case or declared default from a supplied value.
- `fork` atomically activates its branch entries and reciprocal join.
- `join` derives readiness and outcome from declared branch-exit facts.
- `consensus` derives a declared outcome from supplied candidate verdicts.
- `humanGate` waits for, then selects, one declared resolution.
- `terminal` reports the declared pipeline outcome.

The package is pure: it does not save the compiled graph or facts and does not apply a
decision. The host stores durable state, authorizes facts, atomically applies decisions,
handles conflicts/retries, and supplies a fresh complete snapshot.

A future `@revisium/revo-run` can depend on the public `CompiledPipeline`,
`PipelineFacts`, and `PipelineDecision` types. Its current Draft design also expects a
public pipeline decoder for untrusted persisted JSON. No such decoder is part of this
Accepted root manifest, so this MVP does not claim that Draft decoder seam is implemented
or proven.
