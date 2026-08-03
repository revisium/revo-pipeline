import { expect, test } from 'vitest';

import {
  compilePipeline,
  decidePipeline,
  decodeCompiledPipeline,
  definePipeline,
  reducePipeline,
  type CompiledPipeline,
  type ExecutorRequirement,
  type JsonValue,
  type PipelineFacts,
  type PipelineExecutionTemplate,
  type PipelineSnapshot,
  type ScriptIdentity,
  type ScriptNode,
  type TerminalBindingTemplate,
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
  const decoding = decodeCompiledPipeline(JSON.parse(JSON.stringify(compilation.pipeline)));
  expect(decoding.ok).toBe(true);
  if (!decoding.ok) {
    return;
  }
  const pipeline = decoding.pipeline;
  const snapshot: PipelineSnapshot = {
    schemaVersion: 1,
    occurrenceKey: 'public-consumer',
    phase: 'uninitialized',
    values: [],
    nodes: [],
    candidateVerdicts: [],
    gateResolutions: [],
    terminal: null,
  };
  const command = { schemaVersion: 1 as const, kind: 'init' as const, values: [] };
  const initialization = reducePipeline(pipeline, snapshot, command);
  expect(initialization).toMatchObject({
    ok: true,
    application: 'applied',
    status: 'waiting',
    batch: { kind: 'atomic' },
  });
  if (!initialization.ok) {
    return;
  }
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

  const replay = reducePipeline(pipeline, initialization.snapshot, command);
  expect(replay).toEqual({
    ...initialization,
    application: 'unchanged',
    batch: { kind: 'atomic', items: [] },
  });
});

test('exposes the script execution template through the public package surface', () => {
  const script: ScriptIdentity = { id: 'script:system/echo', version: 1 };
  const input: JsonValue = { message: 'Hello' };
  const scriptNode: ScriptNode = {
    kind: 'script',
    key: 'echo',
    script,
    input,
    outcomes: { completed: 'done', failed: 'done', cancelled: 'done', skipped: 'done' },
  };
  const compilation = compilePipeline(
    definePipeline({
      schemaVersion: 1,
      entry: 'echo',
      facts: [],
      nodes: [scriptNode, { kind: 'terminal', key: 'done', outcome: 'succeeded' }],
    }),
  );
  expect(compilation).toMatchObject({
    ok: true,
    template: { executorRequirements: [{ nodeKey: 'echo' }] },
  });
  if (!compilation.ok) {
    return;
  }
  const pipeline: CompiledPipeline = compilation.pipeline;
  const template: PipelineExecutionTemplate = compilation.template;
  const requirement: ExecutorRequirement = template.executorRequirements[0]!;
  const terminal: TerminalBindingTemplate = template.terminalBindings[0]!;
  expect(template.pipeline).toBe(pipeline);
  expect(requirement).toEqual({ kind: 'script', nodeKey: 'echo', script, input });
  expect(terminal).toEqual({ nodeKey: 'done', outcome: 'succeeded' });
});
