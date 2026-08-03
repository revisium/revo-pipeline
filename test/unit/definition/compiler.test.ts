import { describe, expect, test } from 'vitest';

import { compilePipeline, definePipeline } from '../../../src/definition/index.js';
import type { PipelineDefinition } from '../../../src/spec/index.js';

const taskRoutes = (to: string) => ({
  cancelled: to,
  completed: to,
  failed: to,
  skipped: to,
});

const linearDefinition = () => {
  const definition = {
    schemaVersion: 1,
    entry: 'start',
    facts: [
      { key: 'z', type: 'string' },
      { key: 'a', type: 'boolean' },
    ],
    nodes: [
      { kind: 'terminal', key: 'finish', outcome: 'done' },
      { kind: 'task', key: 'start', outcomes: taskRoutes('finish') },
    ],
  } satisfies PipelineDefinition;
  return definition;
};

describe('pipeline definition compilation', () => {
  test('lowers a public script node into the pure graph and an unresolved executor requirement', () => {
    const definition = definePipeline({
      schemaVersion: 1,
      entry: 'echo',
      facts: [],
      nodes: [
        {
          kind: 'script',
          key: 'echo',
          script: { id: 'script:system/echo', version: 1 },
          input: { message: 'Hello from Revo' },
          outcomes: {
            completed: 'done',
            failed: 'failed',
            cancelled: 'failed',
            skipped: 'failed',
          },
        },
        { kind: 'terminal', key: 'done', outcome: 'succeeded' },
        { kind: 'terminal', key: 'failed', outcome: 'failed' },
      ],
    });

    const result = compilePipeline(definition);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pipeline.nodes).toEqual([
      { kind: 'terminal', key: 'done', outcome: 'succeeded' },
      { kind: 'task', key: 'echo', outcomes: definition.nodes[0].outcomes },
      { kind: 'terminal', key: 'failed', outcome: 'failed' },
    ]);
    expect(result.template).toEqual({
      pipeline: result.pipeline,
      executorRequirements: [
        {
          kind: 'script',
          nodeKey: 'echo',
          script: { id: 'script:system/echo', version: 1 },
          input: { message: 'Hello from Revo' },
        },
      ],
      terminalBindings: [
        { nodeKey: 'done', outcome: 'succeeded' },
        { nodeKey: 'failed', outcome: 'failed' },
      ],
    });
    expect(Object.isFrozen(result.template)).toBe(true);
    expect('adapterId' in result.template.executorRequirements[0]!).toBe(false);
  });

  test('snapshots script input without retaining or freezing caller data', () => {
    const input = { message: 'Hello', nested: { value: 1 } };
    const definition = definePipeline({
      schemaVersion: 1,
      entry: 'echo',
      facts: [],
      nodes: [
        {
          kind: 'script',
          key: 'echo',
          script: { id: 'script:system/echo', version: 1 },
          input,
          outcomes: taskRoutes('done'),
        },
        { kind: 'terminal', key: 'done', outcome: 'succeeded' },
      ],
    });

    const result = compilePipeline(definition);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.template.executorRequirements[0]?.input).toEqual(input);
    expect(result.template.executorRequirements[0]?.input).not.toBe(input);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.nested)).toBe(false);
    input.message = 'mutated';
    input.nested.value = 2;
    expect(result.template.executorRequirements[0]?.input).toEqual({
      message: 'Hello',
      nested: { value: 1 },
    });
  });

  test('canonicalizes terminal templates independently of authoring order', () => {
    const definition = definePipeline({
      schemaVersion: 1,
      entry: 'task',
      facts: [],
      nodes: [
        {
          kind: 'task',
          key: 'task',
          outcomes: {
            completed: 'z-terminal',
            failed: 'a-terminal',
            cancelled: 'a-terminal',
            skipped: 'a-terminal',
          },
        },
        { kind: 'terminal', key: 'z-terminal', outcome: 'succeeded' },
        { kind: 'terminal', key: 'a-terminal', outcome: 'failed' },
      ],
    });
    const left = compilePipeline(definition);
    const right = compilePipeline({ ...definition, nodes: [...definition.nodes].reverse() });
    expect(left).toEqual(right);
    expect(left.ok).toBe(true);
    if (!left.ok) {
      return;
    }
    expect(left.template.terminalBindings).toEqual([
      { nodeKey: 'a-terminal', outcome: 'failed' },
      { nodeKey: 'z-terminal', outcome: 'succeeded' },
    ]);
  });

  test.each([
    ['accessor', () => Object.defineProperty({}, 'message', { enumerable: true, get: () => 'x' })],
    [
      'cycle',
      () => {
        const value: { self?: unknown } = {};
        value.self = value;
        return value;
      },
    ],
    [
      'depth',
      () => {
        let value: Record<string, unknown> = {};
        for (let index = 0; index < 10; index += 1) {
          value = { value };
        }
        return value;
      },
    ],
    ['oversize', () => ({ message: 'x'.repeat(513) })],
    ['non-json', () => ({ message: undefined })],
  ])('returns deterministic faults for invalid script input: %s', (_name, createInput) => {
    const definition = {
      schemaVersion: 1,
      entry: 'echo',
      facts: [],
      nodes: [
        {
          kind: 'script',
          key: 'echo',
          script: { id: 'script:system/echo', version: 1 },
          input: createInput(),
          outcomes: taskRoutes('done'),
        },
        { kind: 'terminal', key: 'done', outcome: 'succeeded' },
      ],
    };
    // @ts-expect-error exercises malformed runtime input
    const first = compilePipeline(definition);
    // @ts-expect-error exercises malformed runtime input
    const second = compilePipeline(definition);
    expect(first).toEqual(second);
    expect(first.ok).toBe(false);
    const paths = first.ok ? [] : first.faults.map(({ path }) => path);
    expect(paths.some((path) => path.includes('/input'))).toBe(true);
  });

  test.each([
    ['missing script', { input: {}, outcomes: taskRoutes('done') }, '/nodes/0/script'],
    [
      'malformed script',
      { script: 'script:system/echo', input: {}, outcomes: taskRoutes('done') },
      '/nodes/0/script',
    ],
    [
      'missing id',
      { script: { version: 1 }, input: {}, outcomes: taskRoutes('done') },
      '/nodes/0/script/id',
    ],
    [
      'invalid id',
      { script: { id: 'system/echo', version: 1 }, input: {}, outcomes: taskRoutes('done') },
      '/nodes/0/script/id',
    ],
    [
      'missing version',
      { script: { id: 'script:system/echo' }, input: {}, outcomes: taskRoutes('done') },
      '/nodes/0/script/version',
    ],
    [
      'invalid version',
      { script: { id: 'script:system/echo', version: 0 }, input: {}, outcomes: taskRoutes('done') },
      '/nodes/0/script/version',
    ],
    [
      'missing input',
      { script: { id: 'script:system/echo', version: 1 }, outcomes: taskRoutes('done') },
      '/nodes/0/input',
    ],
    [
      'missing route',
      {
        script: { id: 'script:system/echo', version: 1 },
        input: {},
        outcomes: { completed: 'done', failed: 'done', cancelled: 'done' },
      },
      '/nodes/0/outcomes/skipped',
    ],
    [
      'unknown node field',
      {
        script: { id: 'script:system/echo', version: 1 },
        input: {},
        outcomes: taskRoutes('done'),
        executor: 'host-owned',
      },
      '/nodes/0/executor',
    ],
    [
      'unknown identity field',
      {
        script: { id: 'script:system/echo', version: 1, digest: 'mutable' },
        input: {},
        outcomes: taskRoutes('done'),
      },
      '/nodes/0/script/digest',
    ],
  ])('rejects %s on a script node', (_name, scriptFields, path) => {
    const definition = {
      schemaVersion: 1,
      entry: 'echo',
      facts: [],
      nodes: [
        { kind: 'script', key: 'echo', ...scriptFields },
        { kind: 'terminal', key: 'done', outcome: 'succeeded' },
      ],
    };

    // @ts-expect-error exercises malformed runtime input
    const result = compilePipeline(definition);

    expect(result.ok).toBe(false);
    const paths = result.ok ? [] : result.faults.map((fault) => fault.path);
    expect(paths).toContain(path);
  });

  test('definePipeline is an identity and inference helper', () => {
    const definition = definePipeline({
      schemaVersion: 1,
      entry: 'finish',
      facts: [],
      nodes: [{ kind: 'terminal', key: 'finish', outcome: 'done' }],
    });

    expect(definition.nodes[0]?.kind).toBe('terminal');
    expect(definePipeline(definition)).toBe(definition);
    expect(Object.isFrozen(definition)).toBe(false);
  });

  test('builds canonical frozen portable graph data and exact indexes', () => {
    const input = linearDefinition();
    const result = compilePipeline(input);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.pipeline.facts.map(({ key }) => key)).toEqual(['a', 'z']);
    expect(result.pipeline.nodes.map(({ key }) => key)).toEqual(['finish', 'start']);
    expect(result.pipeline.topologicalOrder).toEqual(['start', 'finish']);
    expect(result.pipeline.nodeIndex).toEqual([
      { key: 'finish', node: 0 },
      { key: 'start', node: 1 },
    ]);
    expect(result.pipeline.outgoingIndex).toEqual([
      { key: 'finish', edges: [] },
      { key: 'start', edges: [0, 1, 2, 3] },
    ]);
    expect(result.pipeline.incomingIndex).toEqual([
      { key: 'finish', edges: [0, 1, 2, 3] },
      { key: 'start', edges: [] },
    ]);
    expect(JSON.parse(JSON.stringify(result.pipeline))).toEqual(result.pipeline);
    expect(Object.isFrozen(result.pipeline)).toBe(true);
    expect(Object.isFrozen(result.pipeline.nodes)).toBe(true);
    expect(Object.isFrozen(result.pipeline.nodes[0])).toBe(true);

    input.facts.reverse();
    expect(result.pipeline.facts.map(({ key }) => key)).toEqual(['a', 'z']);
  });

  test('is invariant to source node, fact and semantic collection order', () => {
    const left = linearDefinition();
    const right: PipelineDefinition = {
      ...linearDefinition(),
      facts: [...linearDefinition().facts].reverse(),
      nodes: [...linearDefinition().nodes].reverse(),
    };

    expect(compilePipeline(left)).toEqual(compilePipeline(right));
  });

  test('classifies fork exits as readiness and emits canonical fork regions', () => {
    const definition: PipelineDefinition = {
      schemaVersion: 1,
      entry: 'fork',
      facts: [],
      nodes: [
        { kind: 'terminal', key: 'terminal', outcome: 'done' },
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'all' },
          outcomes: {
            completed: 'terminal',
            insufficient: 'terminal',
            rejected: 'terminal',
          },
        },
        { kind: 'task', key: 'b', outcomes: taskRoutes('join') },
        { kind: 'task', key: 'a', outcomes: taskRoutes('join') },
        {
          kind: 'fork',
          key: 'fork',
          join: 'join',
          branches: [
            { name: 'beta', entry: 'b', exit: 'b' },
            { name: 'alpha', entry: 'a', exit: 'a' },
          ],
        },
      ],
    };

    const result = compilePipeline(definition);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pipeline.forkRegions).toEqual([
      {
        fork: 'fork',
        join: 'join',
        branches: [
          { name: 'alpha', entry: 'a', exit: 'a', members: ['a'] },
          { name: 'beta', entry: 'b', exit: 'b', members: ['b'] },
        ],
      },
    ]);
    expect(
      result.pipeline.edges
        .filter(({ from }) => from === 'a' || from === 'b')
        .every(({ role, fork }) => role === 'readiness' && fork === 'fork'),
    ).toBe(true);
    expect(
      result.pipeline.edges
        .filter(({ from }) => from === 'fork')
        .every(({ role }) => role === 'activation'),
    ).toBe(true);
    const permuted = structuredClone(definition);
    Reflect.set(permuted, 'nodes', [...permuted.nodes].reverse());
    const permutedFork = permuted.nodes.find((node) => node.kind === 'fork');
    if (permutedFork?.kind === 'fork') {
      Reflect.set(permutedFork, 'branches', [...permutedFork.branches].reverse());
    }
    expect(compilePipeline(permuted)).toEqual(result);
  });

  test('keeps canonical semantic and kernel edge offsets identical after readiness normalization', () => {
    const definition: PipelineDefinition = {
      schemaVersion: 1,
      entry: 'fork',
      facts: [],
      nodes: [
        {
          kind: 'fork',
          key: 'fork',
          join: 'join',
          branches: [
            { name: 'zeta', entry: 'z-exit', exit: 'z-exit' },
            { name: 'alpha', entry: 'a-exit', exit: 'a-exit' },
          ],
        },
        { kind: 'task', key: 'z-exit', outcomes: taskRoutes('join') },
        { kind: 'task', key: 'a-exit', outcomes: taskRoutes('join') },
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'all' },
          outcomes: {
            completed: 'terminal',
            insufficient: 'terminal',
            rejected: 'terminal',
          },
        },
        { kind: 'terminal', key: 'terminal', outcome: 'done' },
      ],
    };
    const result = compilePipeline(definition);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    for (const index of result.pipeline.outgoingIndex) {
      for (const edgeOffset of index.edges) {
        expect(result.pipeline.edges[edgeOffset]?.from).toBe(index.key);
      }
    }
    for (const index of result.pipeline.incomingIndex) {
      for (const edgeOffset of index.edges) {
        expect(result.pipeline.edges[edgeOffset]?.to).toBe(index.key);
      }
    }
    expect(
      result.pipeline.edges
        .filter((edge) => edge.role === 'readiness')
        .map(({ from, outcome, to }) => ({ from, outcome, to })),
    ).toEqual([
      ...Object.keys(taskRoutes('join')).map((outcome) => ({
        from: 'a-exit',
        outcome,
        to: 'join',
      })),
      ...Object.keys(taskRoutes('join')).map((outcome) => ({
        from: 'z-exit',
        outcome,
        to: 'join',
      })),
    ]);
  });

  test('preserves outcome-bearing identity for equal-endpoint semantic edges', () => {
    const result = compilePipeline(linearDefinition());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pipeline.edges.map(({ from, outcome, to }) => ({ from, outcome, to }))).toEqual([
      { from: 'start', outcome: 'cancelled', to: 'finish' },
      { from: 'start', outcome: 'completed', to: 'finish' },
      { from: 'start', outcome: 'failed', to: 'finish' },
      { from: 'start', outcome: 'skipped', to: 'finish' },
    ]);
  });

  test('keeps foreign endpoints diagnostic-only without corrupting induced edge offsets', () => {
    const definition = linearDefinition();
    const start = definition.nodes.find((node) => node.kind === 'task');
    if (start?.kind === 'task') {
      Reflect.set(start.outcomes, 'completed', 'missing');
    }
    const result = compilePipeline(definition);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.faults).toEqual([
      {
        code: 'DEF_TARGET',
        path: '/nodes/1',
        message: 'Unknown target missing.',
      },
    ]);
    expect(result.faults.some(({ message }) => message === 'Invalid graph topology.')).toBe(false);
  });

  test('reports structural edge collisions through accepted node diagnostics', () => {
    const definition = {
      schemaVersion: 1,
      entry: 'branch',
      facts: [{ key: 'choice', type: 'string' }],
      nodes: [
        {
          kind: 'branch',
          key: 'branch',
          fact: 'choice',
          cases: [
            { name: 'same', when: { op: 'equals', value: 'a' }, to: 'finish' },
            { name: 'same', when: { op: 'equals', value: 'b' }, to: 'finish' },
          ],
          default: null,
        },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    };
    // @ts-expect-error exercises a duplicate semantic outcome outside the static contract
    const result = compilePipeline(definition);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.faults).toContainEqual(
      expect.objectContaining({ code: 'DEF_DUPLICATE', path: '/nodes/0/cases/1/name' }),
    );
    expect(result.faults.some(({ message }) => message === 'Invalid graph topology.')).toBe(false);
  });

  test.each([
    [
      'outside join ingress',
      'DEF_FORK_REGION',
      (nodes: PipelineDefinition['nodes']) => {
        const outsider = nodes.find((node) => node.key === 'outsider');
        if (outsider?.kind === 'task') {
          Reflect.set(outsider.outcomes, 'completed', 'join');
        }
      },
    ],
    [
      'outside branch ingress',
      'DEF_FORK_REGION',
      (nodes: PipelineDefinition['nodes']) => {
        const outsider = nodes.find((node) => node.key === 'outsider');
        if (outsider?.kind === 'task') {
          Reflect.set(outsider.outcomes, 'completed', 'a-entry');
        }
      },
    ],
    [
      'branch escape',
      'DEF_FORK_REGION',
      (nodes: PipelineDefinition['nodes']) => {
        const node = nodes.find((entry) => entry.key === 'a-entry');
        if (node?.kind === 'task') {
          Reflect.set(node.outcomes, 'completed', 'terminal');
        }
      },
    ],
    [
      'cross branch edge',
      'DEF_FORK_REGION',
      (nodes: PipelineDefinition['nodes']) => {
        const node = nodes.find((entry) => entry.key === 'a-entry');
        if (node?.kind === 'task') {
          Reflect.set(node.outcomes, 'completed', 'b');
        }
      },
    ],
    [
      'barrier bypass',
      'DEF_FORK_REGION',
      (nodes: PipelineDefinition['nodes']) => {
        const node = nodes.find((entry) => entry.key === 'a-entry');
        if (node?.kind === 'task') {
          Reflect.set(node.outcomes, 'completed', 'join');
        }
      },
    ],
    [
      'nonreciprocal join',
      'DEF_FORK_JOIN',
      (nodes: PipelineDefinition['nodes']) => {
        const node = nodes.find((entry) => entry.key === 'join');
        if (node?.kind === 'join') {
          Reflect.set(node, 'fork', 'foreign');
        }
      },
    ],
    [
      'nested fork',
      'DEF_FORK_NESTED',
      (nodes: PipelineDefinition['nodes']) => {
        const index = nodes.findIndex((entry) => entry.key === 'a-entry');
        Reflect.set(nodes, String(index), {
          kind: 'fork',
          key: 'a-entry',
          join: 'a',
          branches: [
            { name: 'nested-a', entry: 'a', exit: 'a' },
            { name: 'nested-b', entry: 'a', exit: 'a' },
          ],
        });
      },
    ],
  ])('rejects fork topology: %s', (_name, expected, mutate) => {
    const definition: PipelineDefinition = {
      schemaVersion: 1,
      entry: 'fork',
      facts: [],
      nodes: [
        {
          kind: 'fork',
          key: 'fork',
          join: 'join',
          branches: [
            { name: 'a', entry: 'a-entry', exit: 'a' },
            { name: 'b', entry: 'b', exit: 'b' },
          ],
        },
        { kind: 'task', key: 'a-entry', outcomes: taskRoutes('a') },
        { kind: 'task', key: 'a', outcomes: taskRoutes('join') },
        { kind: 'task', key: 'b', outcomes: taskRoutes('join') },
        { kind: 'task', key: 'outsider', outcomes: taskRoutes('terminal') },
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'all' },
          outcomes: {
            completed: 'terminal',
            insufficient: 'terminal',
            rejected: 'terminal',
          },
        },
        { kind: 'terminal', key: 'terminal', outcome: 'done' },
      ],
    };
    mutate(definition.nodes);
    const result = compilePipeline(definition);
    expect(result.ok ? [] : result.faults.map(({ code }) => code)).toContain(expected);
  });

  test('derives fork members without traversing through the join barrier', () => {
    const definition: PipelineDefinition = {
      schemaVersion: 1,
      entry: 'fork',
      facts: [],
      nodes: [
        {
          kind: 'fork',
          key: 'fork',
          join: 'join',
          branches: [{ name: 'branch', entry: 'entry', exit: 'exit' }],
        },
        { kind: 'task', key: 'entry', outcomes: taskRoutes('join') },
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'all' },
          outcomes: {
            completed: 'exit',
            insufficient: 'exit',
            rejected: 'exit',
          },
        },
        { kind: 'task', key: 'exit', outcomes: taskRoutes('terminal') },
        { kind: 'terminal', key: 'terminal', outcome: 'done' },
      ],
    };
    const result = compilePipeline(definition);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.faults).toContainEqual({
      code: 'DEF_FORK_REGION',
      path: '/nodes/0/branches/0/exit',
      message: 'Branch exit must be a member task.',
    });
    expect(result.faults.some(({ code }) => code === 'DEF_CYCLE')).toBe(false);
  });

  test('combines exact fault phases while pruning only unsafe malformed subtrees', () => {
    const malformed = {
      schemaVersion: 2,
      entry: 'missing',
      facts: [
        { key: 'fact', type: 'boolean' },
        { key: 'fact', type: 'boolean' },
      ],
      nodes: [
        {
          kind: 'branch',
          key: 'branch',
          fact: 'foreign',
          cases: [
            { name: 'yes', when: { op: 'equals', value: true }, to: 'missing' },
            { name: 'again', when: { op: 'equals', value: true }, to: 'missing' },
          ],
          default: null,
          extra: true,
        },
        { kind: 'task', key: 'cycle', outcomes: taskRoutes('cycle') },
      ],
      extra: true,
    };

    // @ts-expect-error exercises runtime validation outside the static contract
    const first = compilePipeline(malformed);
    // @ts-expect-error exercises runtime validation outside the static contract
    const second = compilePipeline(malformed);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) {
      return;
    }
    expect(first.faults).toEqual([
      { code: 'DEF_UNKNOWN_FIELD', path: '/extra', message: 'Unknown field.' },
      { code: 'DEF_UNKNOWN_FIELD', path: '/nodes/0/extra', message: 'Unknown field.' },
      {
        code: 'DEF_SCHEMA',
        path: '/schemaVersion',
        message: 'schemaVersion must be 1.',
      },
      { code: 'DEF_DUPLICATE', path: '/facts/1/key', message: 'Duplicate fact key.' },
      {
        code: 'DEF_BRANCH_AMBIGUOUS',
        path: '/nodes/0/cases/1/when',
        message: 'Overlapping case domain.',
      },
      { code: 'DEF_ENTRY', path: '/entry', message: 'Entry must reference a node.' },
      { code: 'DEF_TARGET', path: '/nodes/0', message: 'Unknown target missing.' },
      { code: 'DEF_TARGET', path: '/nodes/0', message: 'Unknown target missing.' },
      { code: 'DEF_TARGET', path: '/nodes/0/fact', message: 'Unknown branch fact.' },
      { code: 'DEF_CYCLE', path: '/nodes', message: 'Pipeline graph contains a cycle.' },
      {
        code: 'DEF_DEAD_END',
        path: '/nodes/0',
        message: 'Node cannot reach a terminal.',
      },
      { code: 'DEF_UNREACHABLE', path: '/nodes/0', message: 'Node is unreachable.' },
      {
        code: 'DEF_DEAD_END',
        path: '/nodes/1',
        message: 'Node cannot reach a terminal.',
      },
      { code: 'DEF_UNREACHABLE', path: '/nodes/1', message: 'Node is unreachable.' },
    ]);
    expect(first.faults).toEqual(second.faults);
  });

  test('detects cycles independently of source ordering', () => {
    const cyclic: PipelineDefinition = {
      schemaVersion: 1,
      entry: 'cycle',
      facts: [],
      nodes: [
        { kind: 'terminal', key: 'finish', outcome: 'done' },
        { kind: 'task', key: 'cycle', outcomes: taskRoutes('cycle') },
      ],
    };
    const result = compilePipeline(cyclic);
    expect(result.ok ? [] : result.faults.map(({ code }) => code)).toContain('DEF_CYCLE');
  });

  test('preserves submitted source indexes across malformed and duplicate nodes', () => {
    const shifted = {
      schemaVersion: 1,
      entry: 'task',
      facts: [],
      nodes: [
        null,
        { kind: 'task', key: 'task', outcomes: taskRoutes('missing') },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    };
    // @ts-expect-error exercises malformed runtime input
    const shiftedResult = compilePipeline(shifted);
    expect(shiftedResult.ok ? [] : shiftedResult.faults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DEF_TYPE', path: '/nodes/0' }),
        expect.objectContaining({ code: 'DEF_TARGET', path: '/nodes/1' }),
        expect.objectContaining({ code: 'DEF_UNREACHABLE', path: '/nodes/2' }),
      ]),
    );

    const duplicate: PipelineDefinition = {
      schemaVersion: 1,
      entry: 'same',
      facts: [],
      nodes: [
        { kind: 'task', key: 'same', outcomes: taskRoutes('missing') },
        { kind: 'terminal', key: 'same', outcome: 'done' },
      ],
    };
    const duplicateResult = compilePipeline(duplicate);
    expect(duplicateResult.ok ? [] : duplicateResult.faults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DEF_DUPLICATE', path: '/nodes/1/key' }),
        expect.objectContaining({ code: 'DEF_TARGET', path: '/nodes/0' }),
      ]),
    );
  });

  test('compiles branch, consensus and gate nodes canonically', () => {
    const definition: PipelineDefinition = {
      schemaVersion: 1,
      entry: 'branch',
      facts: [{ key: 'approved', type: 'boolean' }],
      nodes: [
        {
          kind: 'branch',
          key: 'branch',
          fact: 'approved',
          cases: [
            { name: 'yes', when: { op: 'equals', value: true }, to: 'consensus' },
            { name: 'no', when: { op: 'oneOf', values: [false] }, to: 'consensus' },
          ],
          default: null,
        },
        {
          kind: 'consensus',
          key: 'consensus',
          candidates: ['z', 'a'],
          policy: { kind: 'threshold', approve: 2, reject: 1 },
          outcomes: {
            approved: 'gate',
            rejected: 'gate',
            insufficient: 'gate',
            tied: 'gate',
          },
        },
        {
          kind: 'humanGate',
          key: 'gate',
          subject: 'Proceed?',
          resolutions: [
            { resolution: 'yes', to: 'terminal' },
            { resolution: 'no', to: 'terminal' },
          ],
        },
        { kind: 'terminal', key: 'terminal', outcome: 'done' },
      ],
    };
    const result = compilePipeline(definition);
    expect(result.ok).toBe(true);
    expect(
      result.ok ? result.pipeline.nodes.find((node) => node.kind === 'consensus')?.candidates : [],
    ).toEqual(['a', 'z']);
    const permuted = structuredClone(definition);
    Reflect.set(permuted, 'nodes', [...permuted.nodes].reverse());
    for (const node of permuted.nodes) {
      if (node.kind === 'branch') {
        Reflect.set(node, 'cases', [...node.cases].reverse());
      } else if (node.kind === 'consensus') {
        Reflect.set(node, 'candidates', [...node.candidates].reverse());
      } else if (node.kind === 'humanGate') {
        Reflect.set(node, 'resolutions', [...node.resolutions].reverse());
      }
    }
    expect(compilePipeline(permuted)).toEqual(result);
  });

  test('canonicalizes oneOf values independently of semantic collection order', () => {
    const make = (values: readonly string[]): PipelineDefinition => ({
      schemaVersion: 1,
      entry: 'branch',
      facts: [{ key: 'choice', type: 'string' }],
      nodes: [
        {
          kind: 'branch',
          key: 'branch',
          fact: 'choice',
          cases: [{ name: 'selected', when: { op: 'oneOf', values }, to: 'finish' }],
          default: { name: 'other', to: 'finish' },
        },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    });
    const left = compilePipeline(make(['z', 'a']));
    const right = compilePipeline(make(['a', 'z']));
    expect(left).toEqual(right);
  });

  test('requires the default branch name to be unique and escapes unknown-field paths', () => {
    const definition = {
      schemaVersion: 1,
      entry: 'branch',
      facts: [{ key: 'choice', type: 'string' }],
      nodes: [
        {
          kind: 'branch',
          key: 'branch',
          fact: 'choice',
          cases: [{ name: 'same', when: { op: 'equals', value: 'x' }, to: 'finish' }],
          default: { name: 'same', to: 'finish' },
          'x/y~z': true,
        },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    };
    // @ts-expect-error exercises unknown-field runtime validation
    const result = compilePipeline(definition);
    expect(result.ok ? [] : result.faults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DEF_DUPLICATE', path: '/nodes/0/default/name' }),
        expect.objectContaining({ code: 'DEF_UNKNOWN_FIELD', path: '/nodes/0/x~1y~0z' }),
      ]),
    );
  });

  test.each([
    {
      kind: 'branch',
      key: 'bad',
      fact: 'fact',
      cases: [{ name: 'x', to: 'finish', when: { op: 'oneOf' } }],
      default: null,
    },
    { kind: 'fork', key: 'bad', join: 'finish', branches: [null] },
    { kind: 'join', key: 'bad', fork: 'missing', policy: null, outcomes: {} },
    { kind: 'consensus', key: 'bad', candidates: null, policy: null, outcomes: {} },
    { kind: 'humanGate', key: 'bad', subject: 1, resolutions: [null] },
  ])('never derives or throws after malformed nested shape %#', (node) => {
    const definition = {
      schemaVersion: 1,
      entry: 'bad',
      facts: [{ key: 'fact', type: 'string' }],
      nodes: [node, { kind: 'terminal', key: 'finish', outcome: 'done' }],
    };
    expect(() => {
      // @ts-expect-error exercises runtime validation outside the static contract
      compilePipeline(definition);
    }).not.toThrow();
    // @ts-expect-error exercises runtime validation outside the static contract
    expect(compilePipeline(definition).ok).toBe(false);
  });

  test.each([
    [
      {
        kind: 'branch',
        key: 'bad',
        fact: 'text',
        cases: [
          { name: 'first', when: { op: 'oneOf', values: [] }, to: 'finish' },
          { name: 'first', when: { op: 'oneOf', values: ['x', 'x'] }, to: 'finish' },
        ],
        default: null,
      },
      ['DEF_BRANCH_NON_EXHAUSTIVE', 'DEF_DUPLICATE'],
    ],
    [
      {
        kind: 'fork',
        key: 'bad',
        join: 'finish',
        branches: [{ name: 'only', entry: 'finish', exit: 'finish' }],
      },
      ['DEF_FORK_ARITY', 'DEF_FORK_JOIN'],
    ],
    [
      {
        kind: 'join',
        key: 'bad',
        fork: 'missing',
        policy: { kind: 'threshold', count: 0 },
        outcomes: { completed: 'finish', rejected: 'finish', insufficient: 'finish' },
      },
      ['DEF_JOIN_THRESHOLD', 'DEF_FORK_JOIN'],
    ],
    [
      {
        kind: 'consensus',
        key: 'bad',
        candidates: [],
        policy: { kind: 'quorum', quorum: 0 },
        outcomes: {
          approved: 'finish',
          rejected: 'finish',
          insufficient: 'finish',
          tied: 'finish',
        },
      },
      ['DEF_CONSENSUS_CANDIDATE', 'DEF_CONSENSUS_BOUND'],
    ],
    [
      {
        kind: 'humanGate',
        key: 'bad',
        subject: 'gate',
        resolutions: [
          { resolution: 'same', to: 'finish' },
          { resolution: 'same', to: 'finish' },
        ],
      },
      ['DEF_GATE_RESOLUTION'],
    ],
  ])('validates malformed node policy %#', (node, expectedCodes) => {
    const definition = {
      schemaVersion: 1,
      entry: 'bad',
      facts: [{ key: 'text', type: 'string' }],
      nodes: [node, { kind: 'terminal', key: 'finish', outcome: 'done' }],
    };
    // @ts-expect-error exercises runtime validation outside the static contract
    const result = compilePipeline(definition);
    expect(result.ok ? [] : result.faults.map(({ code }) => code)).toEqual(
      expect.arrayContaining(expectedCodes),
    );
  });

  test('rejects non-object and oversized portable input', () => {
    // @ts-expect-error exercises runtime validation outside the static contract
    const scalar = compilePipeline(null);
    expect(scalar).toEqual({
      ok: false,
      faults: [{ code: 'DEF_TYPE', path: '', message: 'Expected definition object.' }],
    });
    const oversized = {
      ...linearDefinition(),
      nodes: Array.from({ length: 1665 }, () => ({
        kind: 'terminal',
        key: 'same',
        outcome: 'done',
      })),
    };
    // @ts-expect-error exercises runtime validation outside the static contract
    const result = compilePipeline(oversized);
    expect(result.ok ? [] : result.faults.map(({ code }) => code)).toContain('DEF_LIMIT');
  });

  test('globally truncates more than 100 faults to 99 plus the fixed sentinel', () => {
    const definition: PipelineDefinition = {
      schemaVersion: 1,
      entry: 'finish',
      facts: Array.from({ length: 128 }, () => ({ key: 'duplicate', type: 'string' })),
      nodes: [{ kind: 'terminal', key: 'finish', outcome: 'done' }],
    };
    const result = compilePipeline(definition);
    expect(result.ok ? [] : result.faults).toHaveLength(100);
    expect(result.ok ? undefined : result.faults[99]).toEqual({
      code: 'DEF_LIMIT',
      path: '',
      message: 'Fault limit exceeded.',
    });
    const permuted = compilePipeline({ ...definition, facts: [...definition.facts].reverse() });
    expect(permuted).toEqual(result);
    const mixed = { ...definition, schemaVersion: 2, extra: true };
    // @ts-expect-error exercises mixed-phase runtime validation
    const mixedResult = compilePipeline(mixed);
    // @ts-expect-error exercises mixed-phase runtime validation
    const mixedPermuted = compilePipeline({ ...mixed, facts: [...mixed.facts].reverse() });
    expect(mixedPermuted).toEqual(mixedResult);
    expect(mixedResult.ok ? [] : mixedResult.faults.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['DEF_UNKNOWN_FIELD', 'DEF_SCHEMA', 'DEF_DUPLICATE', 'DEF_LIMIT']),
    );
  });

  test('isolates every retained nested collection from caller mutation', () => {
    const definition: PipelineDefinition = {
      schemaVersion: 1,
      entry: 'branch',
      facts: [{ key: 'choice', type: 'string' }],
      nodes: [
        {
          kind: 'branch',
          key: 'branch',
          fact: 'choice',
          cases: [{ name: 'case', when: { op: 'oneOf', values: ['a', 'b'] }, to: 'gate' }],
          default: { name: 'default', to: 'gate' },
        },
        {
          kind: 'humanGate',
          key: 'gate',
          subject: 'subject',
          resolutions: [{ resolution: 'go', to: 'finish' }],
        },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    };
    const result = compilePipeline(definition);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const snapshot = JSON.stringify(result.pipeline);
    Reflect.set(definition.facts[0] ?? {}, 'key', 'mutated');
    const branch = definition.nodes[0];
    if (branch?.kind === 'branch') {
      Reflect.set(branch.cases[0] ?? {}, 'name', 'mutated');
      const predicate = branch.cases[0]?.when;
      if (predicate?.op === 'oneOf') {
        Reflect.set(predicate.values, '0', 'mutated');
      }
      Reflect.set(branch.default ?? {}, 'name', 'mutated');
    }
    const gate = definition.nodes[1];
    if (gate?.kind === 'humanGate') {
      Reflect.set(gate.resolutions[0] ?? {}, 'resolution', 'mutated');
    }
    Reflect.set(definition.nodes, '0', {
      kind: 'terminal',
      key: 'mutated',
      outcome: 'mutated',
    });
    expect(JSON.stringify(result.pipeline)).toBe(snapshot);
  });

  test('rejects accessors without invocation and bounds fault output', () => {
    let calls = 0;
    const definition = linearDefinition();
    Object.defineProperty(definition, 'entry', {
      enumerable: true,
      get: () => {
        calls += 1;
        return 'start';
      },
    });
    const accessorResult = compilePipeline(definition);
    expect(accessorResult).toEqual({
      ok: false,
      faults: [{ code: 'DEF_TYPE', path: '/entry', message: 'Invalid portable input.' }],
    });
    expect(calls).toBe(0);

    const manyUnknown = Object.fromEntries(
      Array.from({ length: 31 }, (_, index) => [`extra${index}`, index]),
    );
    const bounded = compilePipeline({
      ...linearDefinition(),
      ...manyUnknown,
    });
    expect(bounded.ok).toBe(false);
    expect(bounded.ok ? Number.POSITIVE_INFINITY : bounded.faults.length).toBeLessThanOrEqual(100);
  });

  test('prechecks known definition container limits before generic portable traversal', () => {
    let reads = 0;
    const nodes = new Array<unknown>(257);
    Object.defineProperty(nodes, '0', {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        throw new Error('oversized definition must not inspect descendants');
      },
    });
    const definition = { schemaVersion: 1, entry: 'finish', facts: [], nodes };

    // @ts-expect-error exercises malformed runtime input
    expect(compilePipeline(definition)).toEqual({
      ok: false,
      faults: [{ code: 'DEF_LIMIT', path: '/nodes', message: 'Invalid portable input.' }],
    });
    expect(reads).toBe(0);
  });

  test('collects sibling descriptor and nested limit faults while pruning the oversized array', () => {
    let caseReads = 0;
    let nodeReads = 0;
    const cases = new Array<unknown>(65);
    Object.defineProperty(cases, '0', {
      configurable: true,
      enumerable: true,
      get() {
        caseReads += 1;
        throw new Error('oversized cases must not inspect descendants');
      },
    });
    const nodes: unknown[] = [
      {
        kind: 'branch',
        key: 'branch',
        fact: 'choice',
        cases,
        default: { name: 'default', to: 'finish' },
      },
    ];
    Object.defineProperty(nodes, '1', {
      configurable: true,
      enumerable: true,
      get() {
        nodeReads += 1;
        throw new Error('node accessor must not execute');
      },
    });
    nodes.length = 2;
    const definition = {
      schemaVersion: 1,
      entry: 'branch',
      facts: [{ key: 'choice', type: 'string' }],
      nodes,
    };

    // @ts-expect-error exercises malformed runtime input
    const first = compilePipeline(definition);
    // @ts-expect-error exercises malformed runtime input
    const second = compilePipeline(definition);

    expect(first).toEqual({
      ok: false,
      faults: [
        { code: 'DEF_TYPE', path: '/nodes/1', message: 'Invalid portable input.' },
        { code: 'DEF_LIMIT', path: '/nodes/0/cases', message: 'Invalid portable input.' },
      ],
    });
    expect(second).toEqual(first);
    expect(caseReads).toBe(0);
    expect(nodeReads).toBe(0);
  });

  test('collects independent portable definition defects without semantic cascades', () => {
    const definition = {
      schemaVersion: 1,
      entry: 'finish',
      facts: [{ key: undefined, type: 'boolean' }],
      nodes: [{ kind: 'terminal', key: 'finish', outcome: () => 'done' }],
    };

    // @ts-expect-error exercises malformed runtime input
    expect(compilePipeline(definition)).toEqual({
      ok: false,
      faults: [
        { code: 'DEF_TYPE', path: '/facts/0/key', message: 'Invalid portable input.' },
        { code: 'DEF_TYPE', path: '/nodes/0/outcome', message: 'Invalid portable input.' },
      ],
    });
  });
});
