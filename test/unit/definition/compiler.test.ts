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
    expect(first.faults.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'DEF_SCHEMA',
        'DEF_UNKNOWN_FIELD',
        'DEF_DUPLICATE',
        'DEF_BRANCH_AMBIGUOUS',
        'DEF_TARGET',
        'DEF_ENTRY',
        'DEF_CYCLE',
        'DEF_UNREACHABLE',
        'DEF_DEAD_END',
      ]),
    );
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
});
