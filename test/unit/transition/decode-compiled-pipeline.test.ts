import { describe, expect, test } from 'vitest';

import {
  compilePipeline,
  decidePipeline,
  decodeCompiledPipeline,
  type CompiledPipeline,
  type PipelineDefinition,
} from '../../../src/index.js';
import { PIPELINE_LIMITS } from '../../../src/policy/index.js';

const definition: PipelineDefinition = {
  schemaVersion: 1,
  entry: 'task',
  facts: [],
  nodes: [
    {
      kind: 'task',
      key: 'task',
      outcomes: {
        cancelled: 'finish',
        completed: 'finish',
        failed: 'finish',
        skipped: 'finish',
      },
    },
    { kind: 'terminal', key: 'finish', outcome: 'done' },
  ],
};

const compiled = () => {
  const result = compilePipeline(definition);
  if (!result.ok) {
    throw new Error('fixture must compile');
  }
  return result.pipeline;
};

const compiledBranch = (): CompiledPipeline => {
  const result = compilePipeline({
    schemaVersion: 1,
    entry: 'branch',
    facts: [{ key: 'choice', type: 'boolean' }],
    nodes: [
      {
        kind: 'branch',
        key: 'branch',
        fact: 'choice',
        cases: [
          { name: 'false', to: 'end', when: { op: 'equals', value: false } },
          { name: 'true', to: 'end', when: { op: 'equals', value: true } },
        ],
        default: null,
      },
      { kind: 'terminal', key: 'end', outcome: 'done' },
    ],
  });
  if (!result.ok) {
    throw new Error('branch fixture must compile');
  }
  return result.pipeline;
};

const compiledSemanticCollections = (): CompiledPipeline => {
  const routes = (to: string) => ({
    cancelled: to,
    completed: to,
    failed: to,
    skipped: to,
  });
  const result = compilePipeline({
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
      { kind: 'task', key: 'a', outcomes: routes('join') },
      { kind: 'task', key: 'b', outcomes: routes('join') },
      {
        kind: 'join',
        key: 'join',
        fork: 'fork',
        policy: { kind: 'all' },
        outcomes: { completed: 'vote', insufficient: 'vote', rejected: 'vote' },
      },
      {
        kind: 'consensus',
        key: 'vote',
        candidates: ['a', 'b'],
        policy: { kind: 'unanimous' },
        outcomes: { approved: 'gate', insufficient: 'gate', rejected: 'gate', tied: 'gate' },
      },
      {
        kind: 'humanGate',
        key: 'gate',
        subject: 'subject',
        resolutions: [
          { resolution: 'no', to: 'end' },
          { resolution: 'yes', to: 'end' },
        ],
      },
      { kind: 'terminal', key: 'end', outcome: 'done' },
    ],
  });
  if (!result.ok) {
    throw new Error('semantic collection fixture must compile');
  }
  return result.pipeline;
};

const oversized = (maximum: number): readonly null[] =>
  Array.from({ length: maximum + 1 }, () => null);

const precheckMutation = (mutate: (input: CompiledPipeline) => void): CompiledPipeline => {
  const input = structuredClone(compiled());
  mutate(input);
  return input;
};

const setFirstNode = (input: CompiledPipeline, field: string, value: unknown): void => {
  const node = input.nodes[0];
  if (node === undefined) {
    throw new Error('compiled fixture must contain a node');
  }
  Reflect.set(node, field, value);
};

const PRECHECK_LIMIT_CASES = [
  ...[
    ['nodes', PIPELINE_LIMITS.definition.nodes],
    ['edges', PIPELINE_LIMITS.definition.edges],
    ['facts', PIPELINE_LIMITS.definition.declaredFacts],
    ['topologicalOrder', PIPELINE_LIMITS.definition.nodes],
    ['forkRegions', PIPELINE_LIMITS.definition.nodes],
    ['nodeIndex', PIPELINE_LIMITS.definition.nodes],
    ['incomingIndex', PIPELINE_LIMITS.definition.nodes],
    ['outgoingIndex', PIPELINE_LIMITS.definition.nodes],
  ].map(([field, maximum]) => ({
    name: `root ${String(field)}`,
    expectedPath: `/${String(field)}`,
    input: precheckMutation((value) =>
      Reflect.set(value, String(field), oversized(Number(maximum))),
    ),
  })),
  ...[
    ['cases', PIPELINE_LIMITS.definition.branchCasesPerNode],
    ['branches', PIPELINE_LIMITS.definition.forkBranchesPerNode],
    ['candidates', PIPELINE_LIMITS.definition.candidatesPerNode],
    ['resolutions', PIPELINE_LIMITS.definition.resolutionsPerNode],
  ].map(([field, maximum]) => ({
    name: `node ${String(field)}`,
    expectedPath: `/nodes/0/${String(field)}`,
    input: precheckMutation((value) =>
      setFirstNode(value, String(field), oversized(Number(maximum))),
    ),
  })),
  {
    name: 'branch predicate values',
    expectedPath: '/nodes/0/cases/0/when/values',
    input: precheckMutation((value) =>
      setFirstNode(value, 'cases', [
        {
          when: {
            op: 'oneOf',
            values: oversized(PIPELINE_LIMITS.definition.predicateValuesPerCase),
          },
        },
      ]),
    ),
  },
  {
    name: 'fork-region branches',
    expectedPath: '/forkRegions/0/branches',
    input: precheckMutation((value) =>
      Reflect.set(value, 'forkRegions', [
        { branches: oversized(PIPELINE_LIMITS.definition.forkBranchesPerNode) },
      ]),
    ),
  },
  {
    name: 'fork-region branch members',
    expectedPath: '/forkRegions/0/branches/0/members',
    input: precheckMutation((value) =>
      Reflect.set(value, 'forkRegions', [
        { branches: [{ members: oversized(PIPELINE_LIMITS.definition.nodes) }] },
      ]),
    ),
  },
  {
    name: 'aggregate fork-region members',
    expectedPath: '/forkRegions/0/branches/1/members/128',
    input: precheckMutation((value) =>
      Reflect.set(value, 'forkRegions', [
        {
          branches: [
            { members: Array.from({ length: 128 }, () => null) },
            { members: Array.from({ length: 129 }, () => null) },
          ],
        },
      ]),
    ),
  },
  ...(['incomingIndex', 'outgoingIndex'] as const).flatMap((field) => [
    {
      name: `${field} entry offsets`,
      expectedPath: `/${field}/0/edges`,
      input: precheckMutation((value) =>
        Reflect.set(value, field, [{ edges: oversized(PIPELINE_LIMITS.definition.edges) }]),
      ),
    },
    {
      name: `aggregate ${field} offsets`,
      expectedPath: `/${field}/1/edges/512`,
      input: precheckMutation((value) =>
        Reflect.set(value, field, [
          { edges: Array.from({ length: 512 }, () => null) },
          { edges: Array.from({ length: 513 }, () => null) },
        ]),
      ),
    },
  ]),
] as const;

const ROOT_COLLECTIONS = [
  'edges',
  'facts',
  'forkRegions',
  'incomingIndex',
  'nodeIndex',
  'nodes',
  'outgoingIndex',
  'topologicalOrder',
] as const;

const ROOT_SCALAR_CASES = [
  {
    field: 'schemaVersion',
    label: 'missing schemaVersion',
    mutate: (input: CompiledPipeline) => Reflect.deleteProperty(input, 'schemaVersion'),
    message: 'Required compiled pipeline field is missing.',
  },
  {
    field: 'schemaVersion',
    label: 'invalid schemaVersion',
    mutate: (input: CompiledPipeline) => Reflect.set(input, 'schemaVersion', 2),
    message: 'Compiled pipeline schemaVersion must be 1.',
  },
  {
    field: 'entry',
    label: 'missing entry',
    mutate: (input: CompiledPipeline) => Reflect.deleteProperty(input, 'entry'),
    message: 'Required compiled pipeline field is missing.',
  },
  {
    field: 'entry',
    label: 'invalid entry type',
    mutate: (input: CompiledPipeline) => Reflect.set(input, 'entry', 2),
    message: 'Compiled pipeline entry must be a string.',
  },
  {
    field: 'entry',
    label: 'invalid entry domain',
    mutate: (input: CompiledPipeline) => Reflect.set(input, 'entry', ''),
    message: 'Compiled pipeline entry is invalid.',
  },
] as const;

describe('decodeCompiledPipeline', () => {
  test.each(ROOT_SCALAR_CASES)(
    'emits one owning root scalar fault: $label',
    ({ field, message, mutate }) => {
      const input = structuredClone(compiled());
      mutate(input);
      expect(decodeCompiledPipeline(input)).toEqual({
        ok: false,
        faults: [{ code: 'DECODE_SCHEMA', path: `/${field}`, message }],
      });
    },
  );

  test.each(PRECHECK_LIMIT_CASES)(
    'preserves deleted precheck bound: $name',
    ({ input, expectedPath }) => {
      const result = decodeCompiledPipeline(input);
      expect(result).toMatchObject({ ok: false });
      if (result.ok) {
        throw new Error('oversized collection must not decode');
      }
      expect(result.faults).toHaveLength(1);
      expect(result.faults[0]?.code).toBe('DECODE_LIMIT');
      expect(result.faults[0]?.path).toBe(expectedPath);
    },
  );

  test('emits one local fault and prunes dependents when nodes is missing', () => {
    const input = structuredClone(compiled());
    Reflect.deleteProperty(input, 'nodes');
    expect(decodeCompiledPipeline(input)).toEqual({
      ok: false,
      faults: [
        {
          code: 'DECODE_SCHEMA',
          path: '/nodes',
          message: 'Required compiled pipeline field is missing.',
        },
      ],
    });
  });

  test.each(ROOT_COLLECTIONS)(
    'emits one local fault for a missing root collection: %s',
    (field) => {
      const input = structuredClone(compiled());
      Reflect.deleteProperty(input, field);
      expect(decodeCompiledPipeline(input)).toEqual({
        ok: false,
        faults: [
          {
            code: 'DECODE_SCHEMA',
            path: `/${field}`,
            message: 'Required compiled pipeline field is missing.',
          },
        ],
      });
    },
  );

  test.each([
    { facts: true, nodes: true },
    { facts: true, nodes: false },
    { facts: false, nodes: true },
    { facts: false, nodes: false },
  ])(
    'honors root prerequisites with nodes=$nodes facts=$facts',
    ({ nodes: nodesAvailable, facts: factsAvailable }) => {
      const input = structuredClone(compiledBranch());
      const branch = input.nodes.find((node) => node.kind === 'branch');
      if (branch?.kind !== 'branch' || branch.cases[0]?.when.op !== 'equals') {
        throw new Error('branch fixture is missing');
      }
      Reflect.set(branch.cases[0].when, 'value', 'wrong-type');
      Reflect.set(input.edges[0]!, 'role', 'invalid');
      Reflect.set(input.nodeIndex[0]!, 'node', -1);
      if (!nodesAvailable) {
        Reflect.deleteProperty(input, 'nodes');
        if (factsAvailable) {
          Reflect.set(input.facts[0]!, 'key', 3);
        }
      }
      if (!factsAvailable) {
        Reflect.deleteProperty(input, 'facts');
      }
      const result = decodeCompiledPipeline(input);
      expect(result).toMatchObject({ ok: false });
      if (result.ok) {
        throw new Error('cross-product mutation must not decode');
      }
      const paths = result.faults.map((fault) => fault.path);
      expect(paths).toContain('/edges/0/role');
      expect(paths).toContain('/nodeIndex/0/node');
      expect(paths.includes('/nodes')).toBe(!nodesAvailable);
      expect(paths.includes('/facts')).toBe(!factsAvailable);
      expect(paths.includes('/facts/0/key')).toBe(!nodesAvailable && factsAvailable);
      expect(paths.includes('/nodes/0/cases/0/when')).toBe(nodesAvailable && factsAvailable);
      expect(result.faults.some((fault) => fault.code === 'DECODE_REFERENCE')).toBe(false);
    },
  );

  test.each([
    {
      name: 'unavailable',
      mutate: (input: CompiledPipeline) => Reflect.deleteProperty(input, 'facts'),
      localPath: '/facts',
      reference: false,
      predicate: false,
    },
    {
      name: 'malformed entry',
      mutate: (input: CompiledPipeline) => Reflect.set(input.facts, '0', null),
      localPath: '/facts/0',
      reference: false,
      predicate: false,
    },
    {
      name: 'declared invalid type',
      mutate: (input: CompiledPipeline) => Reflect.set(input.facts[0]!, 'type', 'bogus'),
      localPath: '/facts/0/type',
      reference: false,
      predicate: false,
    },
    {
      name: 'valid table absent key',
      mutate: (input: CompiledPipeline) => Reflect.set(input, 'facts', []),
      localPath: undefined,
      reference: true,
      predicate: false,
    },
    {
      name: 'declared valid type',
      mutate: (_input: CompiledPipeline) => undefined,
      localPath: undefined,
      reference: false,
      predicate: true,
    },
  ])('models fact declaration state: $name', ({ mutate, localPath, reference, predicate }) => {
    const input = structuredClone(compiledBranch());
    const branch = input.nodes.find((node) => node.kind === 'branch');
    if (branch?.kind !== 'branch' || branch.cases[0]?.when.op !== 'equals') {
      throw new Error('branch fixture is missing');
    }
    Reflect.set(branch.cases[0].when, 'value', 'wrong-type');
    Reflect.set(branch, 'default', {});
    mutate(input);
    const result = decodeCompiledPipeline(input);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      throw new Error('fact-state mutation must not decode');
    }
    const paths = result.faults.map((fault) => fault.path);
    expect(paths).toContain('/nodes/0/default');
    expect(paths.includes(localPath ?? '__no-local-path__')).toBe(localPath !== undefined);
    expect(paths.includes('/nodes/0/fact')).toBe(reference);
    expect(paths.includes('/nodes/0/cases/0/when')).toBe(predicate);
  });

  test.each([
    {
      collection: 'nodes',
      duplicate: (input: CompiledPipeline) =>
        Reflect.set(input.nodes[1]!, 'key', input.nodes[0]!.key),
      descending: (input: CompiledPipeline) =>
        Reflect.set(input, 'nodes', [...input.nodes].reverse()),
      duplicateCode: 'DECODE_REFERENCE',
      duplicatePath: '/nodes/1/key',
      orderPath: '/nodes/1',
    },
    {
      collection: 'facts',
      duplicate: (input: CompiledPipeline) =>
        Reflect.set(input, 'facts', [
          { key: 'choice', type: 'boolean' },
          { key: 'choice', type: 'boolean' },
        ]),
      descending: (input: CompiledPipeline) =>
        Reflect.set(input, 'facts', [
          { key: 'z', type: 'boolean' },
          { key: 'a', type: 'boolean' },
        ]),
      duplicateCode: 'DECODE_REFERENCE',
      duplicatePath: '/facts/1/key',
      orderPath: '/facts/1',
    },
  ])(
    'separates duplicate from descending $collection keys',
    ({ duplicate, descending, duplicateCode, duplicatePath, orderPath }) => {
      const duplicated = structuredClone(compiledBranch());
      duplicate(duplicated);
      const duplicateResult = decodeCompiledPipeline(duplicated);
      expect(duplicateResult).toMatchObject({ ok: false });
      if (duplicateResult.ok) {
        throw new Error('duplicate mutation must not decode');
      }
      expect(duplicateResult.faults).toContainEqual(
        expect.objectContaining({ code: duplicateCode, path: duplicatePath }),
      );
      expect(duplicateResult.faults).not.toContainEqual(
        expect.objectContaining({ code: 'DECODE_CANONICAL', path: orderPath }),
      );

      const reordered = structuredClone(compiledBranch());
      descending(reordered);
      const orderResult = decodeCompiledPipeline(reordered);
      expect(orderResult).toMatchObject({ ok: false });
      if (orderResult.ok) {
        throw new Error('descending mutation must not decode');
      }
      expect(orderResult.faults).toContainEqual(
        expect.objectContaining({ code: 'DECODE_CANONICAL', path: orderPath }),
      );
      expect(orderResult.faults).not.toContainEqual(
        expect.objectContaining({ code: duplicateCode, path: duplicatePath }),
      );
    },
  );

  test.each([
    {
      collection: 'consensus candidates',
      factory: compiledSemanticCollections,
      duplicatePath: '/nodes/6/candidates/1',
      orderPath: '/nodes/6/candidates/1',
      mutate: (input: CompiledPipeline, values: readonly string[]) => {
        const node = input.nodes.find((entry) => entry.kind === 'consensus');
        if (node?.kind !== 'consensus') {
          throw new Error('consensus fixture is missing');
        }
        Reflect.set(node, 'candidates', values);
      },
    },
    {
      collection: 'fork branch names',
      factory: compiledSemanticCollections,
      duplicatePath: '/nodes/3/branches/1/name',
      orderPath: '/nodes/3/branches/1',
      mutate: (input: CompiledPipeline, values: readonly string[]) => {
        const node = input.nodes.find((entry) => entry.kind === 'fork');
        if (node?.kind !== 'fork') {
          throw new Error('fork fixture is missing');
        }
        node.branches.forEach((entry, index) => Reflect.set(entry, 'name', values[index]));
      },
    },
    {
      collection: 'human resolutions',
      factory: compiledSemanticCollections,
      duplicatePath: '/nodes/4/resolutions/1/resolution',
      orderPath: '/nodes/4/resolutions/1',
      mutate: (input: CompiledPipeline, values: readonly string[]) => {
        const node = input.nodes.find((entry) => entry.kind === 'humanGate');
        if (node?.kind !== 'humanGate') {
          throw new Error('human fixture is missing');
        }
        node.resolutions.forEach((entry, index) => Reflect.set(entry, 'resolution', values[index]));
      },
    },
    {
      collection: 'branch case names',
      factory: compiledBranch,
      duplicatePath: '/nodes/0/cases/1/name',
      orderPath: '/nodes/0/cases/1',
      mutate: (input: CompiledPipeline, values: readonly string[]) => {
        const node = input.nodes.find((entry) => entry.kind === 'branch');
        if (node?.kind !== 'branch') {
          throw new Error('branch fixture is missing');
        }
        node.cases.forEach((entry, index) => Reflect.set(entry, 'name', values[index]));
      },
    },
    {
      collection: 'region branch names',
      factory: compiledSemanticCollections,
      duplicatePath: '/forkRegions/0/branches/1/name',
      orderPath: '/forkRegions/0/branches/1',
      mutate: (input: CompiledPipeline, values: readonly string[]) => {
        input.forkRegions[0]!.branches.forEach((entry, index) =>
          Reflect.set(entry, 'name', values[index]),
        );
      },
    },
    {
      collection: 'region member references',
      factory: compiledSemanticCollections,
      duplicatePath: '/forkRegions/0/branches/0/members/1',
      orderPath: '/forkRegions/0/branches/0/members/1',
      duplicateValues: ['a', 'a'],
      orderValues: ['b', 'a'],
      mutate: (input: CompiledPipeline, values: readonly string[]) =>
        Reflect.set(input.forkRegions[0]!.branches[0]!, 'members', values),
    },
    {
      collection: 'node-index keys',
      factory: compiledSemanticCollections,
      duplicatePath: '/nodeIndex/1/key',
      orderPath: '/nodeIndex/1',
      mutate: (input: CompiledPipeline, values: readonly string[]) =>
        input.nodeIndex
          .slice(0, 2)
          .forEach((entry, index) => Reflect.set(entry, 'key', values[index])),
    },
    {
      collection: 'incoming-index keys',
      factory: compiledSemanticCollections,
      duplicatePath: '/incomingIndex/1/key',
      orderPath: '/incomingIndex/1',
      mutate: (input: CompiledPipeline, values: readonly string[]) =>
        input.incomingIndex
          .slice(0, 2)
          .forEach((entry, index) => Reflect.set(entry, 'key', values[index])),
    },
    {
      collection: 'outgoing-index keys',
      factory: compiledSemanticCollections,
      duplicatePath: '/outgoingIndex/1/key',
      orderPath: '/outgoingIndex/1',
      mutate: (input: CompiledPipeline, values: readonly string[]) =>
        input.outgoingIndex
          .slice(0, 2)
          .forEach((entry, index) => Reflect.set(entry, 'key', values[index])),
    },
  ])(
    'classifies duplicate and descending $collection uniformly',
    ({ duplicatePath, duplicateValues, factory, orderPath, orderValues, mutate }) => {
      const duplicated = structuredClone(factory());
      mutate(duplicated, duplicateValues ?? ['same', 'same']);
      const duplicateResult = decodeCompiledPipeline(duplicated);
      expect(duplicateResult).toMatchObject({ ok: false });
      if (duplicateResult.ok) {
        throw new Error('duplicate collection must not decode');
      }
      expect(duplicateResult.faults).toContainEqual(
        expect.objectContaining({ code: 'DECODE_REFERENCE', path: duplicatePath }),
      );
      expect(duplicateResult.faults).not.toContainEqual(
        expect.objectContaining({ code: 'DECODE_CANONICAL', path: orderPath }),
      );

      const descending = structuredClone(factory());
      mutate(descending, orderValues ?? ['z', 'a']);
      const orderResult = decodeCompiledPipeline(descending);
      expect(orderResult).toMatchObject({ ok: false });
      if (orderResult.ok) {
        throw new Error('descending collection must not decode');
      }
      expect(orderResult.faults).toContainEqual(
        expect.objectContaining({ code: 'DECODE_CANONICAL', path: orderPath }),
      );
      expect(orderResult.faults).not.toContainEqual(
        expect.objectContaining({ code: 'DECODE_REFERENCE', path: duplicatePath }),
      );
    },
  );

  test.each([
    { label: 'duplicate', values: [false, false], canonical: false },
    { label: 'descending', values: [true, false], canonical: true },
  ])('separates $label predicate values from strict ordering', ({ values, canonical }) => {
    const input = structuredClone(compiledBranch());
    const branch = input.nodes.find((node) => node.kind === 'branch');
    if (branch?.kind !== 'branch') {
      throw new Error('branch fixture is missing');
    }
    Reflect.set(branch.cases[0]!, 'when', { op: 'oneOf', values });
    const result = decodeCompiledPipeline(input);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      throw new Error('predicate mutation must not decode');
    }
    expect(
      result.faults.some(
        (fault) => fault.code === 'DECODE_CANONICAL' && fault.path === '/nodes/0/cases/0/when',
      ),
    ).toBe(canonical);
  });

  test.each(ROOT_COLLECTIONS)(
    'emits one local fault for an unsafe root collection: %s',
    (field) => {
      const input = structuredClone(compiled());
      Reflect.set(input, field, 1);
      expect(decodeCompiledPipeline(input)).toEqual({
        ok: false,
        faults: [
          {
            code: 'DECODE_SCHEMA',
            path: `/${field}`,
            message: 'Compiled pipeline field must be an array.',
          },
        ],
      });
    },
  );

  test('decodes a JSON round trip into a deeply frozen owned snapshot', () => {
    const input = JSON.parse(JSON.stringify(compiled())) as unknown;
    const result = decodeCompiledPipeline(input);
    expect(result).toMatchObject({ ok: true });
    expect(Object.isFrozen(result)).toBe(true);
    if (!result.ok) {
      throw new Error('round trip must decode');
    }
    expect(result.pipeline).not.toBe(input);
    expect(Object.isFrozen(result.pipeline)).toBe(true);
    expect(result.pipeline).toEqual(input);
  });

  test.each([null, undefined, 1, 'pipeline', Symbol('pipeline'), 1n, () => undefined])(
    'rejects a non-container root without throwing',
    (input) => {
      expect(decodeCompiledPipeline(input)).toEqual({
        ok: false,
        faults: [
          {
            code: 'DECODE_TYPE',
            path: '',
            message: 'Compiled pipeline value is not portable data.',
          },
        ],
      });
    },
  );

  test('classifies declared collection bounds separately from diagnostic truncation', () => {
    const input = structuredClone(compiled());
    Reflect.set(
      input,
      'nodes',
      Array.from({ length: 1_001 }, () => null),
    );
    expect(decodeCompiledPipeline(input)).toEqual({
      ok: false,
      faults: [
        {
          code: 'DECODE_LIMIT',
          path: '/nodes',
          message: 'Compiled pipeline collection exceeds its limit.',
        },
      ],
    });
  });

  test('never invokes accessors and preserves the decision compatibility fault', () => {
    let reads = 0;
    const input = structuredClone(compiled());
    Object.defineProperty(input, 'nodes', {
      enumerable: true,
      get() {
        reads += 1;
        return [];
      },
    });
    expect(decodeCompiledPipeline(input)).toMatchObject({ ok: false });
    expect(reads).toBe(0);
    expect(
      decidePipeline(input, {
        values: [],
        nodes: [],
        candidateVerdicts: [],
        gateResolutions: [],
      }),
    ).toEqual({
      kind: 'reject',
      faults: [
        {
          code: 'PIPELINE_INVALID',
          path: '',
          message: 'Compiled pipeline is invalid.',
        },
      ],
    });
  });

  test('returns deterministic diagnostics for equivalent insertion orders', () => {
    const left = { schemaVersion: 1, entry: 'missing' };
    const right = { entry: 'missing', schemaVersion: 1 };
    expect(decodeCompiledPipeline(left)).toEqual(decodeCompiledPipeline(right));
  });

  test('keeps inspecting independent collections after a root-shape fault', () => {
    const input = structuredClone(compiled());
    Reflect.set(input, 'extra', 1);
    Reflect.set(input.nodes[0]!, 'outcome', 3);
    expect(decodeCompiledPipeline(input)).toEqual({
      ok: false,
      faults: [
        {
          code: 'DECODE_SCHEMA',
          path: '/extra',
          message: 'Compiled pipeline field is not allowed.',
        },
        {
          code: 'DECODE_SCHEMA',
          path: '/nodes/0/outcome',
          message: 'Compiled terminal outcome must be a string.',
        },
      ],
    });
  });

  test('classifies invalid serialized edge ownership before canonical comparison', () => {
    const foreignFork = structuredClone(compiled());
    Reflect.set(foreignFork.edges[0]!, 'fork', 'task');
    expect(decodeCompiledPipeline(foreignFork)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_REFERENCE', path: '/edges/0/fork' }],
    });

    const inconsistentBranch = structuredClone(compiled());
    Reflect.set(inconsistentBranch.edges[0]!, 'branch', 'foreign');
    expect(decodeCompiledPipeline(inconsistentBranch)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_REFERENCE', path: '/edges/0/fork' }],
    });
  });

  test('accumulates independent sibling faults and appends the exact diagnostic sentinel', () => {
    const input = structuredClone(compiled());
    Reflect.set(
      input,
      'nodes',
      Array.from({ length: 101 }, () => null),
    );
    const result = decodeCompiledPipeline(input);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      throw new Error('malformed nodes must not decode');
    }
    expect(result.faults).toHaveLength(100);
    expect(result.faults.slice(0, 99).every((fault) => fault.code === 'DECODE_SCHEMA')).toBe(true);
    expect(result.faults[99]).toEqual({
      code: 'DECODE_DIAGNOSTIC_LIMIT',
      path: '/faults',
      message: 'Compiled pipeline diagnostic limit exceeded.',
    });
    expect(Object.isFrozen(result.faults)).toBe(true);
  });

  test('orders schema, reference, and canonical faults by phase and input path', () => {
    const input = structuredClone(compiled());
    Reflect.set(input, 'entry', 'foreign');
    Reflect.set(input.nodes[0]!, 'key', 'z');
    Reflect.set(input.nodes[1]!, 'key', 'a');
    Reflect.set(input.edges[0]!, 'to', 'foreign');
    const result = decodeCompiledPipeline(input);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      throw new Error('tampered references must not decode');
    }
    const phases = result.faults.map((fault) => fault.code);
    expect(phases.indexOf('DECODE_CANONICAL')).toBeGreaterThan(
      phases.lastIndexOf('DECODE_REFERENCE'),
    );
    expect(result.faults).toContainEqual(
      expect.objectContaining({ code: 'DECODE_REFERENCE', path: '/entry' }),
    );
    expect(result.faults).toContainEqual(
      expect.objectContaining({ code: 'DECODE_CANONICAL', path: '/nodes/1' }),
    );
  });

  test('reports the smallest serialized path for schema and derived canonical faults', () => {
    const schemaInput = structuredClone(compiled());
    Reflect.deleteProperty(schemaInput.nodes[0]!, 'outcome');
    expect(decodeCompiledPipeline(schemaInput)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_SCHEMA', path: '/nodes/0/outcome' }],
    });

    const canonicalInput = structuredClone(compiled());
    Reflect.set(canonicalInput.edges[0]!, 'outcome', 'invented');
    expect(decodeCompiledPipeline(canonicalInput)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_CANONICAL', path: '/edges/0/outcome' }],
    });
  });

  test('reports graph failure only after canonical serialized data passes', () => {
    const input = structuredClone(compiled());
    const task = input.nodes.find((node) => node.kind === 'task');
    if (task?.kind !== 'task') {
      throw new Error('task fixture is missing');
    }
    Reflect.set(task, 'outcomes', {
      cancelled: 'task',
      completed: 'task',
      failed: 'task',
      skipped: 'task',
    });
    Reflect.set(
      input,
      'edges',
      ['cancelled', 'completed', 'failed', 'skipped'].map((outcome) => ({
        branch: null,
        fork: null,
        from: 'task',
        outcome,
        role: 'activation',
        to: 'task',
      })),
    );
    expect(decodeCompiledPipeline(input)).toEqual({
      ok: false,
      faults: [
        {
          code: 'DECODE_GRAPH',
          path: '/edges',
          message: 'Compiled pipeline graph contains a cycle.',
        },
      ],
    });
  });

  test('contains revoked and throwing proxy reflection', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => decodeCompiledPipeline(proxy)).not.toThrow();
    expect(decodeCompiledPipeline(proxy)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_TYPE', path: '' }],
    });
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('ownKeys');
        },
      },
    );
    expect(() => decodeCompiledPipeline(hostile)).not.toThrow();
    expect(decodeCompiledPipeline(hostile)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_TYPE', path: '' }],
    });
  });

  test('accumulates undefined siblings and emits one missing-member defect', () => {
    expect(decodeCompiledPipeline({ entry: undefined, schemaVersion: undefined })).toMatchObject({
      ok: false,
      faults: [
        { code: 'DECODE_TYPE', path: '/entry' },
        { code: 'DECODE_TYPE', path: '/schemaVersion' },
      ],
    });
    const missing = structuredClone(compiled());
    Reflect.deleteProperty(missing, 'schemaVersion');
    const result = decodeCompiledPipeline(missing);
    expect(result).toEqual({
      ok: false,
      faults: [
        {
          code: 'DECODE_SCHEMA',
          path: '/schemaVersion',
          message: 'Required compiled pipeline field is missing.',
        },
      ],
    });
  });

  test('locates scalar, index, and topology tampering at the owning member', () => {
    const scalar = structuredClone(compiled());
    Reflect.set(scalar.nodes[0]!, 'outcome', 3);
    expect(decodeCompiledPipeline(scalar)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_SCHEMA', path: '/nodes/0/outcome' }],
    });

    const offset = structuredClone(compiled());
    Reflect.set(offset.incomingIndex[0]!.edges, 0, 9_999);
    expect(decodeCompiledPipeline(offset)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_REFERENCE', path: '/incomingIndex/0/edges/0' }],
    });

    const topology = structuredClone(compiled());
    Reflect.set(topology, 'topologicalOrder', [...topology.topologicalOrder].reverse());
    expect(decodeCompiledPipeline(topology)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_CANONICAL', path: '/topologicalOrder' }],
    });
  });

  test('locates a foreign fork branch exit', () => {
    const result = compilePipeline({
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
        {
          kind: 'task',
          key: 'a',
          outcomes: { cancelled: 'join', completed: 'join', failed: 'join', skipped: 'join' },
        },
        {
          kind: 'task',
          key: 'b',
          outcomes: { cancelled: 'join', completed: 'join', failed: 'join', skipped: 'join' },
        },
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'all' },
          outcomes: { completed: 'end', insufficient: 'end', rejected: 'end' },
        },
        { kind: 'terminal', key: 'end', outcome: 'done' },
      ],
    });
    if (!result.ok) {
      throw new Error('fork fixture must compile');
    }
    const input = structuredClone(result.pipeline);
    const fork = input.nodes.find((node) => node.kind === 'fork');
    if (fork?.kind !== 'fork') {
      throw new Error('fork fixture is missing');
    }
    Reflect.set(fork.branches[0]!, 'exit', 'foreign');
    expect(decodeCompiledPipeline(input)).toMatchObject({
      ok: false,
      faults: [
        { code: 'DECODE_REFERENCE', path: `/nodes/${input.nodes.indexOf(fork)}/branches/0/exit` },
      ],
    });

    const lowerBound = structuredClone(result.pipeline);
    const lowerFork = lowerBound.nodes.find((node) => node.kind === 'fork');
    if (lowerFork?.kind !== 'fork') {
      throw new Error('fork fixture is missing');
    }
    Reflect.set(lowerFork, 'branches', lowerFork.branches.slice(0, 1));
    const lowerResult = decodeCompiledPipeline(lowerBound);
    expect(lowerResult).toMatchObject({ ok: false });
    if (lowerResult.ok) {
      throw new Error('undersized fork must not decode');
    }
    expect(lowerResult.faults).toContainEqual(
      expect.objectContaining({
        code: 'DECODE_SCHEMA',
        path: `/nodes/${lowerBound.nodes.indexOf(lowerFork)}/branches`,
      }),
    );
  });

  test('classifies branch fact shape before declared-fact lookup', () => {
    const result = compilePipeline({
      schemaVersion: 1,
      entry: 'branch',
      facts: [{ key: 'choice', type: 'string' }],
      nodes: [
        {
          kind: 'branch',
          key: 'branch',
          fact: 'choice',
          cases: [{ name: 'yes', to: 'end', when: { op: 'equals', value: 'yes' } }],
          default: { name: 'other', to: 'end' },
        },
        { kind: 'terminal', key: 'end', outcome: 'done' },
      ],
    });
    if (!result.ok) {
      throw new Error('branch fixture must compile');
    }
    const invalid = structuredClone(result.pipeline);
    const branch = invalid.nodes.find((node) => node.kind === 'branch');
    if (branch?.kind !== 'branch') {
      throw new Error('branch fixture is missing');
    }
    Reflect.set(branch, 'fact', 1);
    expect(decodeCompiledPipeline(invalid)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_SCHEMA', path: `/nodes/${invalid.nodes.indexOf(branch)}/fact` }],
    });
    Reflect.set(branch, 'fact', 'undeclared');
    expect(decodeCompiledPipeline(invalid)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_REFERENCE', path: `/nodes/${invalid.nodes.indexOf(branch)}/fact` }],
    });
  });

  test('restores aggregate candidate and resolution limits', () => {
    const aggregate = (kind: 'consensus' | 'humanGate') => {
      const input = structuredClone(compiled());
      const nodes = Array.from({ length: 33 }, (_, index) => {
        const count = index === 32 ? 1 : 32;
        return kind === 'consensus'
          ? {
              candidates: Array.from(
                { length: count },
                (__, candidate) => `candidate-${String(candidate).padStart(2, '0')}`,
              ),
              key: `aggregate-${String(index).padStart(2, '0')}`,
              kind,
              outcomes: {
                approved: 'finish',
                insufficient: 'finish',
                rejected: 'finish',
                tied: 'finish',
              },
              policy: { kind: 'unanimous' },
            }
          : {
              key: `aggregate-${String(index).padStart(2, '0')}`,
              kind,
              resolutions: Array.from({ length: count }, (__, resolution) => ({
                resolution: `resolution-${String(resolution).padStart(2, '0')}`,
                to: 'finish',
              })),
              subject: 'subject',
            };
      });
      Reflect.set(input, 'nodes', [...nodes, ...input.nodes]);
      return decodeCompiledPipeline(input);
    };
    expect(aggregate('consensus')).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_LIMIT', path: '/nodes/32/candidates' }],
    });
    expect(aggregate('humanGate')).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_LIMIT', path: '/nodes/32/resolutions' }],
    });
  });

  test('owns edge role and exact task outcome-key schema paths', () => {
    const role = structuredClone(compiled());
    Reflect.set(role.edges[0]!, 'role', 'bad');
    expect(decodeCompiledPipeline(role)).toMatchObject({
      ok: false,
      faults: [{ code: 'DECODE_SCHEMA', path: '/edges/0/role' }],
    });

    const outcome = structuredClone(compiled());
    const task = outcome.nodes.find((node) => node.kind === 'task');
    if (task?.kind !== 'task') {
      throw new Error('task fixture is missing');
    }
    Reflect.deleteProperty(task.outcomes, 'cancelled');
    expect(decodeCompiledPipeline(outcome)).toMatchObject({
      ok: false,
      faults: [
        {
          code: 'DECODE_SCHEMA',
          path: `/nodes/${outcome.nodes.indexOf(task)}/outcomes/cancelled`,
        },
      ],
    });
  });

  test('rejects a null-prototype array without repairing it', () => {
    const input = structuredClone(compiled());
    Object.setPrototypeOf(input.nodes, null);
    expect(decodeCompiledPipeline(input)).toEqual({
      ok: false,
      faults: [
        {
          code: 'DECODE_TYPE',
          path: '/nodes',
          message: 'Compiled pipeline container prototype is invalid.',
        },
      ],
    });
  });

  test('bounds visited-value exhaustion to one deterministic limit fault', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        `sibling${index}`,
        Array.from({ length: 1_664 }, () => null),
      ]),
    );
    const result = decodeCompiledPipeline(wide);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      throw new Error('wide hostile input must not decode');
    }
    expect(result.faults).toEqual([
      {
        code: 'DECODE_LIMIT',
        path: '/sibling9/1397',
        message: 'Compiled pipeline exceeds its value limit.',
      },
    ]);
  });
});
