import { describe, expect, test } from 'vitest';

import { compilePipeline } from '../../../src/definition/index.js';
import { PIPELINE_LIMITS } from '../../../src/policy/index.js';
import type {
  CompiledPipeline,
  NodeFact,
  PipelineDefinition,
  PipelineFacts,
  PipelineValueFact,
} from '../../../src/spec/index.js';
import { decidePipeline } from '../../../src/transition/index.js';

const taskRoutes = (to: string) => ({
  cancelled: to,
  completed: to,
  failed: to,
  skipped: to,
});

const compile = (definition: PipelineDefinition): CompiledPipeline => {
  const result = compilePipeline(definition);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.faults));
  }
  return result.pipeline;
};

const facts = (
  nodes: readonly NodeFact[] = [],
  values: readonly PipelineValueFact[] = [],
): PipelineFacts => ({ nodes, values, candidateVerdicts: [], gateResolutions: [] });

const linear = (): CompiledPipeline =>
  compile({
    schemaVersion: 1,
    entry: 'start',
    facts: [],
    nodes: [
      { kind: 'task', key: 'start', outcomes: taskRoutes('finish') },
      { kind: 'terminal', key: 'finish', outcome: 'done' },
    ],
  });

const branching = (): CompiledPipeline =>
  compile({
    schemaVersion: 1,
    entry: 'choose',
    facts: [{ key: 'choice', type: 'boolean' }],
    nodes: [
      {
        kind: 'branch',
        key: 'choose',
        fact: 'choice',
        cases: [{ name: 'yes', when: { op: 'equals', value: true }, to: 'yes' }],
        default: { name: 'no', to: 'no' },
      },
      { kind: 'terminal', key: 'yes', outcome: 'accepted' },
      { kind: 'terminal', key: 'no', outcome: 'declined' },
    ],
  });

describe('core pipeline transitions', () => {
  test('activates entry and replays the same deterministic decision', () => {
    const pipeline = linear();
    const input = facts();
    const snapshot = structuredClone(input);
    const expected = {
      kind: 'activate',
      cause: { kind: 'entry' },
      nodeKeys: ['start'],
    };

    expect(decidePipeline(pipeline, input)).toEqual(expected);
    expect(decidePipeline(pipeline, input)).toEqual(expected);
    expect(input).toEqual(snapshot);
  });

  test('waits for an enabled task and activates its missing successor after completion', () => {
    const pipeline = linear();
    expect(decidePipeline(pipeline, facts([{ key: 'start', state: 'enabled' }]))).toEqual({
      kind: 'wait',
      nodeKey: 'start',
      reason: 'task-incomplete',
    });
    expect(
      decidePipeline(pipeline, facts([{ key: 'start', state: 'terminal', outcome: 'completed' }])),
    ).toEqual({
      kind: 'activate',
      cause: { kind: 'node', nodeKey: 'start', outcome: 'completed' },
      nodeKeys: ['finish'],
    });
  });

  test('terminal precedence is stable for enabled and terminal terminal-node facts', () => {
    const pipeline = linear();
    const prefix: NodeFact = { key: 'start', state: 'terminal', outcome: 'completed' };
    expect(decidePipeline(pipeline, facts([prefix, { key: 'finish', state: 'enabled' }]))).toEqual({
      kind: 'terminal',
      nodeKey: 'finish',
      outcome: 'done',
    });
    expect(
      decidePipeline(
        pipeline,
        facts([prefix, { key: 'finish', state: 'terminal', outcome: 'done' }]),
      ),
    ).toEqual({ kind: 'terminal', nodeKey: 'finish', outcome: 'done' });
  });

  test('branch waits for its declared fact, then selects exact or default outcome', () => {
    const pipeline = branching();
    const enabled: NodeFact = { key: 'choose', state: 'enabled' };
    expect(decidePipeline(pipeline, facts([enabled]))).toEqual({
      kind: 'wait',
      nodeKey: 'choose',
      reason: 'branch-fact-missing',
    });
    expect(decidePipeline(pipeline, facts([enabled], [{ key: 'choice', value: true }]))).toEqual({
      kind: 'select',
      nodeKey: 'choose',
      outcome: 'yes',
      activate: ['yes'],
    });
    expect(decidePipeline(pipeline, facts([enabled], [{ key: 'choice', value: false }]))).toEqual({
      kind: 'select',
      nodeKey: 'choose',
      outcome: 'no',
      activate: ['no'],
    });
  });

  test('terminal branch completion requires its selected target atomically', () => {
    const pipeline = branching();
    expect(
      decidePipeline(pipeline, facts([{ key: 'choose', state: 'terminal', outcome: 'yes' }])),
    ).toMatchObject({ kind: 'reject', faults: [{ code: 'FACT_CAUSAL' }] });
    expect(
      decidePipeline(
        pipeline,
        facts([
          { key: 'choose', state: 'terminal', outcome: 'yes' },
          { key: 'yes', state: 'enabled' },
        ]),
      ),
    ).toEqual({ kind: 'terminal', nodeKey: 'yes', outcome: 'accepted' });
  });

  test('terminal branch outcome must agree with the retained value selection', () => {
    const pipeline = branching();
    expect(
      decidePipeline(
        pipeline,
        facts(
          [
            { key: 'choose', state: 'terminal', outcome: 'yes' },
            { key: 'yes', state: 'enabled' },
          ],
          [{ key: 'choice', value: false }],
        ),
      ),
    ).toMatchObject({
      kind: 'reject',
      faults: [{ code: 'FACT_OUTCOME', path: '/nodes/0/outcome' }],
    });
  });

  test('actions outrank waits in canonical topological order', () => {
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'choose',
      facts: [{ key: 'choice', type: 'boolean' }],
      nodes: [
        {
          kind: 'branch',
          key: 'choose',
          fact: 'choice',
          cases: [{ name: 'left', when: { op: 'equals', value: true }, to: 'left' }],
          default: { name: 'right', to: 'right' },
        },
        { kind: 'task', key: 'left', outcomes: taskRoutes('finish') },
        { kind: 'task', key: 'right', outcomes: taskRoutes('finish') },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    });
    expect(
      decidePipeline(
        pipeline,
        facts([
          { key: 'choose', state: 'terminal', outcome: 'left' },
          { key: 'left', state: 'terminal', outcome: 'completed' },
        ]),
      ),
    ).toEqual({
      kind: 'activate',
      cause: { kind: 'node', nodeKey: 'left', outcome: 'completed' },
      nodeKeys: ['finish'],
    });
  });

  test('continues after an applied branch target is present and returns its wait', () => {
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'choose',
      facts: [{ key: 'choice', type: 'boolean' }],
      nodes: [
        {
          kind: 'branch',
          key: 'choose',
          fact: 'choice',
          cases: [{ name: 'yes', when: { op: 'equals', value: true }, to: 'work' }],
          default: { name: 'no', to: 'finish' },
        },
        { kind: 'task', key: 'work', outcomes: taskRoutes('finish') },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    });
    expect(
      decidePipeline(
        pipeline,
        facts(
          [
            { key: 'choose', state: 'terminal', outcome: 'yes' },
            { key: 'work', state: 'enabled' },
          ],
          [{ key: 'choice', value: true }],
        ),
      ),
    ).toEqual({ kind: 'wait', nodeKey: 'work', reason: 'task-incomplete' });
  });

  test('is invariant to valid fact permutation', () => {
    const pipeline = linear();
    const left = facts([
      { key: 'start', state: 'terminal', outcome: 'completed' },
      { key: 'finish', state: 'enabled' },
    ]);
    const right = facts([...left.nodes].reverse());
    expect(decidePipeline(pipeline, left)).toEqual(decidePipeline(pipeline, right));
  });

  test('characterizes entry-omitted, enabled, and terminal fact states for task, branch, and terminal nodes', () => {
    const terminalEntry = compile({
      schemaVersion: 1,
      entry: 'finish',
      facts: [],
      nodes: [{ kind: 'terminal', key: 'finish', outcome: 'done' }],
    });
    expect(decidePipeline(terminalEntry, facts())).toMatchObject({ kind: 'activate' });
    expect(
      decidePipeline(terminalEntry, facts([{ key: 'finish', state: 'enabled' }])),
    ).toMatchObject({ kind: 'terminal' });
    expect(
      decidePipeline(terminalEntry, facts([{ key: 'finish', state: 'terminal', outcome: 'done' }])),
    ).toMatchObject({ kind: 'terminal' });

    expect(decidePipeline(branching(), facts())).toMatchObject({ kind: 'activate' });
    expect(decidePipeline(branching(), facts([{ key: 'choose', state: 'enabled' }]))).toMatchObject(
      { kind: 'wait' },
    );
    expect(
      decidePipeline(
        branching(),
        facts([
          { key: 'choose', state: 'terminal', outcome: 'yes' },
          { key: 'yes', state: 'enabled' },
        ]),
      ),
    ).toMatchObject({ kind: 'terminal' });

    expect(decidePipeline(linear(), facts())).toMatchObject({ kind: 'activate' });
    expect(decidePipeline(linear(), facts([{ key: 'start', state: 'enabled' }]))).toMatchObject({
      kind: 'wait',
    });
    expect(
      decidePipeline(linear(), facts([{ key: 'start', state: 'terminal', outcome: 'completed' }])),
    ).toMatchObject({ kind: 'activate' });
  });

  test('non-entry omitted nodes emit no decision before their activation edge is satisfied', () => {
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'choose',
      facts: [{ key: 'choice', type: 'boolean' }],
      nodes: [
        {
          kind: 'branch',
          key: 'choose',
          fact: 'choice',
          cases: [{ name: 'yes', when: { op: 'equals', value: true }, to: 'work' }],
          default: { name: 'no', to: 'work' },
        },
        { kind: 'task', key: 'work', outcomes: taskRoutes('finish') },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    });

    expect(decidePipeline(pipeline, facts([{ key: 'choose', state: 'enabled' }]))).toEqual({
      kind: 'wait',
      nodeKey: 'choose',
      reason: 'branch-fact-missing',
    });
  });

  test('rejects malformed, foreign, duplicate, mistyped, and noncausal facts before progress', () => {
    const pipeline = linear();
    expect(
      decidePipeline(
        pipeline,
        facts([
          { key: 'start', state: 'enabled' },
          { key: 'start', state: 'enabled' },
        ]),
      ),
    ).toMatchObject({ kind: 'reject', faults: [{ code: 'FACT_DUPLICATE' }] });
    expect(decidePipeline(pipeline, facts([{ key: 'foreign', state: 'enabled' }]))).toMatchObject({
      kind: 'reject',
      faults: [{ code: 'FACT_FOREIGN' }],
    });
    expect(decidePipeline(linear(), facts([{ key: 'finish', state: 'enabled' }]))).toMatchObject({
      kind: 'reject',
      faults: [{ code: 'FACT_CAUSAL' }],
    });
    expect(
      decidePipeline(branching(), facts([], [{ key: 'choice', value: 'true' }])),
    ).toMatchObject({ kind: 'reject', faults: [{ code: 'FACT_TYPE' }] });
  });

  test('rejects a compiled payload whose edge set contains a cycle', () => {
    const pipeline = linear();
    const cyclic: CompiledPipeline = structuredClone(pipeline);
    const forward = cyclic.edges[0]!;
    Reflect.set(cyclic, 'edges', [
      ...cyclic.edges,
      { ...forward, from: forward.to, to: forward.from },
    ]);
    expect(decidePipeline(cyclic, facts())).toMatchObject({
      kind: 'reject',
      faults: [{ code: 'PIPELINE_INVALID' }],
    });
  });

  test('rejects a compiled payload whose stored topological order disagrees with the graph', () => {
    const pipeline = linear();
    const tampered: CompiledPipeline = structuredClone(pipeline);
    Reflect.set(tampered, 'topologicalOrder', [...tampered.topologicalOrder].reverse());
    expect(decidePipeline(tampered, facts())).toMatchObject({
      kind: 'reject',
      faults: [{ code: 'PIPELINE_INVALID' }],
    });
  });

  test('rejects a value fact string beyond the display bound', () => {
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'start',
      facts: [{ key: 'note', type: 'string' }],
      nodes: [
        { kind: 'task', key: 'start', outcomes: taskRoutes('finish') },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    });
    const bound = PIPELINE_LIMITS.portable.displayCodePoints;
    expect(
      decidePipeline(pipeline, facts([], [{ key: 'note', value: 'x'.repeat(bound) }])),
    ).toEqual({
      kind: 'activate',
      cause: { kind: 'entry' },
      nodeKeys: ['start'],
    });
    expect(
      decidePipeline(pipeline, facts([], [{ key: 'note', value: 'x'.repeat(bound + 1) }])),
    ).toMatchObject({ kind: 'reject', faults: [{ code: 'FACT_LIMIT', path: '/values/0/value' }] });
  });

  test('faults the aggregate fact bound from raw collection lengths', () => {
    const pipeline = linear();
    const oversized = {
      values: Array.from({ length: 129 }, (_, index) => ({ key: `v${index}`, value: true })),
      nodes: Array.from({ length: 257 }, (_, index) => ({
        key: `n${index}`,
        state: 'enabled' as const,
      })),
      candidateVerdicts: Array.from({ length: 1_025 }, () => ({
        nodeKey: 'start',
        candidate: 'a',
        verdict: 'approve' as const,
      })),
      gateResolutions: Array.from({ length: 257 }, () => ({
        nodeKey: 'start',
        resolution: 'done',
      })),
    };
    const decision = decidePipeline(pipeline, oversized);
    const codes =
      decision.kind === 'reject'
        ? decision.faults.map((fault) => `${fault.code}${fault.path}`)
        : [];
    expect(decision.kind).toBe('reject');
    expect(codes).toContain('FACT_LIMIT');
    expect(codes).toContain('FACT_LIMIT/values');
    expect(codes).toContain('FACT_LIMIT/nodes');
    expect(codes).toContain('FACT_LIMIT/candidateVerdicts');
    expect(codes).toContain('FACT_LIMIT/gateResolutions');
  });

  test('accepts every collection at its exact bound and faults each at bound plus one', () => {
    const pipeline = linear();
    const within = {
      values: [],
      nodes: [
        { key: 'start', state: 'enabled' as const },
        ...Array.from({ length: 255 }, (_, index) => ({
          key: `ghost${index}`,
          state: 'enabled' as const,
        })),
      ],
      candidateVerdicts: [],
      gateResolutions: [],
    };
    const atBound = decidePipeline(pipeline, within);
    expect(atBound.kind).toBe('reject');
    const boundCodes =
      atBound.kind === 'reject' ? atBound.faults.map((fault) => `${fault.code}${fault.path}`) : [];
    expect(boundCodes).not.toContain('FACT_LIMIT/nodes');
    for (const field of ['values', 'nodes', 'candidateVerdicts', 'gateResolutions'] as const) {
      const limit = PIPELINE_LIMITS.facts[field === 'nodes' ? 'nodes' : field];
      const overflow = {
        values: [],
        nodes: [],
        candidateVerdicts: [],
        gateResolutions: [],
        [field]: Array.from({ length: limit + 1 }, () => ({})),
      };
      const decision = decidePipeline(pipeline, overflow);
      const codes =
        decision.kind === 'reject'
          ? decision.faults.map((fault) => `${fault.code}${fault.path}`)
          : [];
      expect(codes).toContain(`FACT_LIMIT/${field}`);
    }
  });

  test('truncates beyond 100 faults to the first 99 plus a root sentinel', () => {
    const pipeline = linear();
    const foreign = Array.from({ length: 150 }, (_, index) => ({
      key: `ghost${index}`,
      state: 'enabled' as const,
    }));
    const decision = decidePipeline(pipeline, facts(foreign));
    expect(decision.kind).toBe('reject');
    const faultList = decision.kind === 'reject' ? decision.faults : [];
    expect(faultList).toHaveLength(100);
    expect(faultList.slice(0, 99).every((fault) => fault.code === 'FACT_FOREIGN')).toBe(true);
    expect(faultList[99]).toMatchObject({ code: 'FACT_LIMIT', path: '' });
  });

  test('valid executions never observe noop or an empty activation', () => {
    const gated = compile({
      schemaVersion: 1,
      entry: 'approval',
      facts: [],
      nodes: [
        {
          kind: 'humanGate',
          key: 'approval',
          subject: 'Approve',
          resolutions: [{ resolution: 'approved', to: 'finish' }],
        },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    });
    const forked = compile({
      schemaVersion: 1,
      entry: 'fork',
      facts: [],
      nodes: [
        {
          kind: 'fork',
          key: 'fork',
          join: 'join',
          branches: [
            { name: 'first', entry: 'left', exit: 'left' },
            { name: 'second', entry: 'right', exit: 'right' },
          ],
        },
        { kind: 'task', key: 'left', outcomes: taskRoutes('join') },
        { kind: 'task', key: 'right', outcomes: taskRoutes('join') },
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'all' },
          outcomes: { completed: 'finish', rejected: 'finish', insufficient: 'finish' },
        },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    });
    for (const pipeline of [linear(), branching(), gated, forked]) {
      const nodes = new Map<string, NodeFact>();
      const values: PipelineValueFact[] = [];
      const gateResolutions: { nodeKey: string; resolution: string }[] = [];
      const observedKinds: string[] = [];
      let emptyActivations = 0;
      for (let step = 0; step < 64; step += 1) {
        const decision = decidePipeline(pipeline, {
          values,
          nodes: [...nodes.values()],
          candidateVerdicts: [],
          gateResolutions,
        });
        observedKinds.push(decision.kind);
        if (decision.kind === 'activate') {
          emptyActivations += decision.nodeKeys.length === 0 ? 1 : 0;
          decision.nodeKeys.forEach((key) => nodes.set(key, { key, state: 'enabled' }));
        } else if (decision.kind === 'select') {
          nodes.set(decision.nodeKey, {
            key: decision.nodeKey,
            state: 'terminal',
            outcome: decision.outcome,
          });
          decision.activate.forEach((key) => nodes.set(key, { key, state: 'enabled' }));
        } else if (decision.kind === 'wait') {
          if (decision.reason === 'task-incomplete') {
            nodes.set(decision.nodeKey, {
              key: decision.nodeKey,
              state: 'terminal',
              outcome: 'completed',
            });
          } else if (decision.reason === 'branch-fact-missing') {
            values.push({ key: 'choice', value: true });
          } else {
            gateResolutions.push({ nodeKey: decision.nodeKey, resolution: 'approved' });
          }
        } else {
          break;
        }
      }
      expect(observedKinds).not.toContain('noop');
      expect(observedKinds).not.toContain('reject');
      expect(emptyActivations).toBe(0);
      expect(observedKinds.at(-1)).toBe('terminal');
    }
  });

  test('faults precede an otherwise reached terminal and multiple terminals are rejected', () => {
    const pipeline = branching();
    const reached: NodeFact[] = [
      { key: 'choose', state: 'terminal', outcome: 'yes' },
      { key: 'yes', state: 'enabled' },
    ];
    expect(
      decidePipeline(pipeline, {
        ...facts(reached),
        gateResolutions: [{ nodeKey: 'foreign', resolution: 'approve' }],
      }),
    ).toMatchObject({ kind: 'reject', faults: [{ code: 'FACT_FOREIGN' }] });
    expect(
      decidePipeline(pipeline, facts([...reached, { key: 'no', state: 'enabled' }])),
    ).toMatchObject({ kind: 'reject', faults: [{ code: 'FACT_CAUSAL' }] });
  });

  test('accepts coordination graphs in the internal evaluator', () => {
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'fork',
      facts: [],
      nodes: [
        {
          kind: 'fork',
          key: 'fork',
          join: 'join',
          branches: [
            { name: 'a', entry: 'a', exit: 'a' },
            { name: 'b', entry: 'b', exit: 'b' },
          ],
        },
        { kind: 'task', key: 'a', outcomes: taskRoutes('join') },
        { kind: 'task', key: 'b', outcomes: taskRoutes('join') },
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'all' },
          outcomes: {
            completed: 'finish',
            insufficient: 'finish',
            rejected: 'finish',
          },
        },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    });

    expect(decidePipeline(pipeline, facts())).toEqual({
      kind: 'activate',
      cause: { kind: 'entry' },
      nodeKeys: ['fork'],
    });
  });
});
