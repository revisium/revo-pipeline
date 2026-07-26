import { expect, test } from 'vitest';

import {
  compilePipeline,
  decidePipeline,
  definePipeline,
  type PipelineFacts,
} from '../../src/index.js';

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

test('supports the documented deterministic public root workflow with isolated compiled data', () => {
  expect(definition.entry).toBe('approval');
  const compilation = compilePipeline(definition);
  expect(compilation.ok).toBe(true);
  if (!compilation.ok) {
    return;
  }
  const pipeline = structuredClone(compilation.pipeline);
  const emptyFacts: PipelineFacts = {
    values: [],
    nodes: [],
    candidateVerdicts: [],
    gateResolutions: [],
  };
  expect(decidePipeline(pipeline, emptyFacts)).toEqual({
    kind: 'activate',
    cause: { kind: 'entry' },
    nodeKeys: ['approval'],
  });

  const unresolvedFacts: PipelineFacts = {
    ...emptyFacts,
    nodes: [{ key: 'approval', state: 'enabled' }],
  };
  expect(decidePipeline(pipeline, unresolvedFacts)).toEqual({
    kind: 'wait',
    nodeKey: 'approval',
    reason: 'gate-unresolved',
  });

  const resolvedFacts: PipelineFacts = {
    ...unresolvedFacts,
    gateResolutions: [{ nodeKey: 'approval', resolution: 'approved' }],
  };
  const expected = {
    kind: 'select',
    nodeKey: 'approval',
    outcome: 'approved',
    activate: ['published'],
  };
  expect(decidePipeline(pipeline, resolvedFacts)).toEqual(expected);
  expect(decidePipeline(pipeline, resolvedFacts)).toEqual(expected);
});
