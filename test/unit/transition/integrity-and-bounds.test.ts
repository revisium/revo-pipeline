import { describe, expect, test } from 'vitest';

import { compilePipeline } from '../../../src/definition/index.js';
import { topologicalSort } from '../../../src/graph/index.js';
import { compareUnicodeCodePoints, PIPELINE_LIMITS } from '../../../src/policy/index.js';
import type {
  BranchNode,
  CompiledEdge,
  CompiledPipeline,
  PipelineDefinition,
  PipelineFacts,
} from '../../../src/spec/index.js';
import { decidePipeline, validateCompiledPipeline } from '../../../src/transition/index.js';

const compile = (definition: PipelineDefinition): CompiledPipeline => {
  const result = compilePipeline(definition);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.faults));
  }
  return result.pipeline;
};

const emptyFacts = (): PipelineFacts => ({
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
});

const FACT_COLLECTION_NAMES = ['values', 'nodes', 'candidateVerdicts', 'gateResolutions'] as const;

const branchPipeline = (): CompiledPipeline =>
  compile({
    schemaVersion: 1,
    entry: 'choose',
    facts: [{ key: 'choice', type: 'boolean' }],
    nodes: [
      {
        kind: 'branch',
        key: 'choose',
        fact: 'choice',
        cases: [
          { name: 'false', when: { op: 'oneOf', values: [false] }, to: 'no' },
          { name: 'true', when: { op: 'oneOf', values: [true] }, to: 'yes' },
        ],
        default: null,
      },
      { kind: 'terminal', key: 'no', outcome: 'no' },
      { kind: 'terminal', key: 'yes', outcome: 'yes' },
    ],
  });

const forgedOverlappingRegion = (): {
  readonly definition: PipelineDefinition;
  readonly pipeline: CompiledPipeline;
} => {
  const routes = (to: string) => ({
    cancelled: to,
    completed: to,
    failed: to,
    skipped: to,
  });
  const definition: PipelineDefinition = {
    schemaVersion: 1,
    entry: 'fork',
    facts: [],
    nodes: [
      { kind: 'task', key: 'a', outcomes: routes('shared') },
      { kind: 'task', key: 'b', outcomes: routes('shared') },
      {
        kind: 'fork',
        key: 'fork',
        join: 'join',
        branches: [
          { name: 'a', entry: 'a', exit: 'x' },
          { name: 'b', entry: 'b', exit: 'y' },
        ],
      },
      {
        kind: 'join',
        key: 'join',
        fork: 'fork',
        policy: { kind: 'all' },
        outcomes: { completed: 'terminal', insufficient: 'terminal', rejected: 'terminal' },
      },
      {
        kind: 'task',
        key: 'shared',
        outcomes: { cancelled: 'x', completed: 'x', failed: 'y', skipped: 'y' },
      },
      { kind: 'terminal', key: 'terminal', outcome: 'done' },
      { kind: 'task', key: 'x', outcomes: routes('join') },
      { kind: 'task', key: 'y', outcomes: routes('join') },
    ],
  };
  const nodes = [...definition.nodes].sort((left, right) =>
    compareUnicodeCodePoints(left.key, right.key),
  );
  const activationEdge = (from: string, outcome: string, to: string): CompiledEdge => ({
    from,
    outcome,
    to,
    role: 'activation',
    fork: null,
    branch: null,
  });
  const edges = nodes.flatMap((node): readonly CompiledEdge[] => {
    if (node.kind === 'task' || node.kind === 'join') {
      return Object.entries(node.outcomes).map(([outcome, to]) =>
        node.kind === 'task' && (node.key === 'x' || node.key === 'y')
          ? {
              ...activationEdge(node.key, outcome, to),
              role: 'readiness',
              fork: 'fork',
              branch: node.key,
            }
          : activationEdge(node.key, outcome, to),
      );
    }
    if (node.kind === 'fork') {
      return [
        ...node.branches.map((branch) => ({
          ...activationEdge(node.key, 'forked', branch.entry),
          fork: node.key,
          branch: branch.name,
        })),
        { ...activationEdge(node.key, 'forked', node.join), fork: node.key },
      ];
    }
    return [];
  });
  edges.sort(
    (left, right) =>
      compareUnicodeCodePoints(left.from, right.from) ||
      compareUnicodeCodePoints(left.outcome, right.outcome) ||
      compareUnicodeCodePoints(left.to, right.to) ||
      compareUnicodeCodePoints(left.role, right.role) ||
      compareUnicodeCodePoints(left.fork ?? '', right.fork ?? '') ||
      compareUnicodeCodePoints(left.branch ?? '', right.branch ?? ''),
  );
  const keys = nodes.map((node) => node.key);
  const topologicalOrder = topologicalSort(keys, edges);
  if (!topologicalOrder) {
    throw new Error('Forged test graph must remain acyclic.');
  }
  const edgeIndex = (direction: 'incoming' | 'outgoing') =>
    nodes.map((node) => ({
      key: node.key,
      edges: edges.flatMap((edge, offset) =>
        edge[direction === 'incoming' ? 'to' : 'from'] === node.key ? [offset] : [],
      ),
    }));
  return {
    definition,
    pipeline: {
      schemaVersion: 1,
      entry: definition.entry,
      facts: [],
      nodes,
      edges,
      topologicalOrder,
      forkRegions: [
        {
          fork: 'fork',
          join: 'join',
          branches: [
            { name: 'a', entry: 'a', exit: 'x', members: ['a', 'shared', 'x'] },
            { name: 'b', entry: 'b', exit: 'y', members: ['b', 'shared', 'y'] },
          ],
        },
      ],
      nodeIndex: nodes.map((node, index) => ({ key: node.key, node: index })),
      incomingIndex: edgeIndex('incoming'),
      outgoingIndex: edgeIndex('outgoing'),
    },
  };
};

describe('compiled integrity', () => {
  test.each([0, 64, 65, 512])(
    'retains a canonical terminal display outcome of %i code points',
    (length) => {
      const pipeline = compile({
        schemaVersion: 1,
        entry: 'finish',
        facts: [],
        nodes: [{ kind: 'terminal', key: 'finish', outcome: 'x'.repeat(length) }],
      });
      expect(validateCompiledPipeline(pipeline).ok).toBe(true);
    },
  );

  test('rejects a terminal display outcome beyond the retained display bound', () => {
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'finish',
      facts: [],
      nodes: [{ kind: 'terminal', key: 'finish', outcome: 'x'.repeat(512) }],
    });
    const tampered = structuredClone(pipeline);
    const terminal = tampered.nodes[0];
    if (terminal?.kind === 'terminal') {
      Reflect.set(terminal, 'outcome', 'x'.repeat(513));
    }
    expect(validateCompiledPipeline(tampered)).toEqual({ ok: false });
  });

  test('accepts the compiler-retained unpaired-surrogate outcome after JSON round-trip', () => {
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'finish',
      facts: [],
      nodes: [{ kind: 'terminal', key: 'finish', outcome: '\ud800' }],
    });
    const roundTrip: unknown = JSON.parse(JSON.stringify(pipeline));
    expect(validateCompiledPipeline(roundTrip).ok).toBe(true);
  });

  test.each([
    ['foreign declared fact', (node: BranchNode) => Reflect.set(node, 'fact', 'missing')],
    [
      'predicate type drift',
      (node: BranchNode) => Reflect.set(node.cases[0]!.when, 'values', ['false']),
    ],
    ['empty oneOf', (node: BranchNode) => Reflect.set(node.cases[0]!.when, 'values', [])],
    [
      'duplicate predicate domain',
      (node: BranchNode) => Reflect.set(node.cases[0]!.when, 'values', [false, false]),
    ],
    [
      'overlapping cases',
      (node: BranchNode) => Reflect.set(node.cases[1]!.when, 'values', [false]),
    ],
    [
      'noncanonical case order',
      (node: BranchNode) => Reflect.set(node, 'cases', [...node.cases].reverse()),
    ],
    [
      'unreachable default',
      (node: BranchNode) => Reflect.set(node, 'default', { name: 'other', to: 'no' }),
    ],
  ])('rejects retained branch integrity drift: %s', (_name, mutate) => {
    const pipeline = structuredClone(branchPipeline());
    const branch = pipeline.nodes.find((node) => node.kind === 'branch');
    if (branch) {
      mutate(branch);
    }
    expect(validateCompiledPipeline(pipeline)).toEqual({ ok: false });
  });

  test('rejects noncanonical scalar normalization instead of repairing compiled input', () => {
    const numberPipeline = compile({
      schemaVersion: 1,
      entry: 'choose',
      facts: [{ key: 'number', type: 'number' }],
      nodes: [
        {
          kind: 'branch',
          key: 'choose',
          fact: 'number',
          cases: [{ name: 'zero', when: { op: 'equals', value: 0 }, to: 'yes' }],
          default: { name: 'other', to: 'no' },
        },
        { kind: 'terminal', key: 'no', outcome: 'no' },
        { kind: 'terminal', key: 'yes', outcome: 'yes' },
      ],
    });
    const negativeZero = structuredClone(numberPipeline);
    const numberBranch = negativeZero.nodes.find((node) => node.kind === 'branch');
    if (numberBranch?.kind === 'branch' && numberBranch.cases[0]?.when.op === 'equals') {
      Reflect.set(numberBranch.cases[0].when, 'value', -0);
    }
    expect(validateCompiledPipeline(negativeZero)).toEqual({ ok: false });

    const decomposed = structuredClone(numberPipeline);
    const terminal = decomposed.nodes.find((node) => node.kind === 'terminal');
    if (terminal?.kind === 'terminal') {
      Reflect.set(terminal, 'outcome', 'e\u0301');
    }
    expect(validateCompiledPipeline(decomposed)).toEqual({ ok: false });
  });

  test('rejects incomplete node indexes and ghost edge targets', () => {
    const missingIndex = structuredClone(branchPipeline());
    Reflect.set(missingIndex, 'nodeIndex', []);
    expect(validateCompiledPipeline(missingIndex)).toEqual({ ok: false });

    const ghostTarget = structuredClone(branchPipeline());
    Reflect.set(ghostTarget.edges[0]!, 'to', 'ghost');
    expect(validateCompiledPipeline(ghostTarget)).toEqual({ ok: false });
  });

  test('rejects a canonical forged graph whose fork branches overlap', () => {
    const forged = forgedOverlappingRegion();
    const compilation = compilePipeline(forged.definition);
    const regionFault = !compilation.ok
      ? compilation.faults.find((fault) => fault.code === 'DEF_FORK_REGION')
      : undefined;
    expect(regionFault?.code).toBe('DEF_FORK_REGION');
    expect(validateCompiledPipeline(forged.pipeline)).toEqual({ ok: false });
    expect(decidePipeline(forged.pipeline, emptyFacts())).toMatchObject({
      kind: 'reject',
      faults: [{ code: 'PIPELINE_INVALID' }],
    });
  });

  test.each([
    ['nodes', PIPELINE_LIMITS.definition.nodes],
    ['edges', PIPELINE_LIMITS.definition.edges],
    ['facts', PIPELINE_LIMITS.definition.declaredFacts],
    ['topologicalOrder', PIPELINE_LIMITS.definition.nodes],
    ['forkRegions', PIPELINE_LIMITS.definition.nodes],
    ['nodeIndex', PIPELINE_LIMITS.definition.nodes],
    ['incomingIndex', PIPELINE_LIMITS.definition.nodes],
    ['outgoingIndex', PIPELINE_LIMITS.definition.nodes],
  ])('prunes oversized compiled %s before inspecting its elements', (field, maximum) => {
    const pipeline = structuredClone(branchPipeline());
    let reads = 0;
    const collection = new Array<unknown>(maximum + 1);
    Object.defineProperty(collection, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        reads += 1;
        return null;
      },
    });
    Reflect.set(pipeline, field, collection);
    expect(validateCompiledPipeline(pipeline)).toEqual({ ok: false });
    expect(reads).toBe(0);
  });

  test('rejects in-range accessor elements without invoking node, case, or edge-offset getters', () => {
    const nodePipeline = structuredClone(branchPipeline());
    let nodeReads = 0;
    Object.defineProperty(nodePipeline.nodes, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        nodeReads += 1;
        throw new Error('node getter invoked');
      },
    });
    expect(validateCompiledPipeline(nodePipeline)).toEqual({ ok: false });
    expect(nodeReads).toBe(0);

    const casePipeline = structuredClone(branchPipeline());
    const branch = casePipeline.nodes.find((node) => node.kind === 'branch');
    let caseReads = 0;
    if (branch?.kind === 'branch') {
      Object.defineProperty(branch.cases, '0', {
        configurable: true,
        enumerable: true,
        get: () => {
          caseReads += 1;
          throw new Error('case getter invoked');
        },
      });
    }
    expect(validateCompiledPipeline(casePipeline)).toEqual({ ok: false });
    expect(caseReads).toBe(0);

    const offsetPipeline = structuredClone(branchPipeline());
    let offsetReads = 0;
    Object.defineProperty(offsetPipeline.incomingIndex[0]!.edges, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        offsetReads += 1;
        throw new Error('offset getter invoked');
      },
    });
    expect(validateCompiledPipeline(offsetPipeline)).toEqual({ ok: false });
    expect(offsetReads).toBe(0);
  });

  test('prunes oversized nested case and predicate arrays before element inspection', () => {
    const casesPipeline = structuredClone(branchPipeline());
    const branch = casesPipeline.nodes.find((node) => node.kind === 'branch');
    let caseReads = 0;
    const cases = new Array<unknown>(PIPELINE_LIMITS.definition.branchCasesPerNode + 1);
    Object.defineProperty(cases, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        caseReads += 1;
        return null;
      },
    });
    if (branch?.kind === 'branch') {
      Reflect.set(branch, 'cases', cases);
    }
    expect(validateCompiledPipeline(casesPipeline)).toEqual({ ok: false });
    expect(caseReads).toBe(0);

    const valuesPipeline = structuredClone(branchPipeline());
    const valuesBranch = valuesPipeline.nodes.find((node) => node.kind === 'branch');
    let valueReads = 0;
    const values = new Array<unknown>(PIPELINE_LIMITS.definition.predicateValuesPerCase + 1);
    Object.defineProperty(values, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        valueReads += 1;
        return false;
      },
    });
    if (valuesBranch?.kind === 'branch' && valuesBranch.cases[0]?.when.op === 'oneOf') {
      Reflect.set(valuesBranch.cases[0].when, 'values', values);
    }
    expect(validateCompiledPipeline(valuesPipeline)).toEqual({ ok: false });
    expect(valueReads).toBe(0);

    const offsetsPipeline = structuredClone(branchPipeline());
    let offsetReads = 0;
    const offsets = new Array<unknown>(PIPELINE_LIMITS.definition.edges + 1);
    Object.defineProperty(offsets, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        offsetReads += 1;
        return 0;
      },
    });
    Reflect.set(offsetsPipeline.outgoingIndex[0]!, 'edges', offsets);
    expect(validateCompiledPipeline(offsetsPipeline)).toEqual({ ok: false });
    expect(offsetReads).toBe(0);
  });
});

describe('fact bounds and diagnostics', () => {
  test.each(FACT_COLLECTION_NAMES)(
    'requires exact Array.prototype for the %s fact collection',
    (field) => {
      const input = emptyFacts();
      Object.setPrototypeOf(input[field], null);
      const decision = decidePipeline(branchPipeline(), input);
      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') {
        return;
      }
      expect(decision.faults.map(({ code, path }) => ({ code, path }))).toEqual([
        { code: 'FACT_TYPE', path: `/${field}` },
      ]);
    },
  );

  test('reports one container fault for a sparse collection and prunes descendants', () => {
    const input = emptyFacts();
    const sparse = new Array<PipelineFacts['values'][number]>(1);
    Reflect.set(input, 'values', sparse);
    const decision = decidePipeline(branchPipeline(), input);
    expect(decision.kind).toBe('reject');
    if (decision.kind !== 'reject') {
      return;
    }
    expect(decision.faults.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'FACT_TYPE', path: '/values' },
    ]);
  });

  test.each([100, 128])(
    'stops globally at the first visit-limit issue for %i large fact entries',
    (count) => {
      let reads = 0;
      const values = Array.from({ length: count }, (_entry, index) => ({
        key: `fact-${index}`,
        value: Array.from({ length: 200 }, () => true),
      }));
      Object.defineProperty(values[count - 1]!, 'value', {
        configurable: true,
        enumerable: true,
        get: () => {
          reads += 1;
          throw new Error('post-budget getter invoked');
        },
      });
      const input = emptyFacts();
      Reflect.set(input, 'values', values);
      const decision = decidePipeline(branchPipeline(), input);
      expect(reads).toBe(0);
      expect(decision.kind).toBe('reject');
      if (decision.kind !== 'reject') {
        return;
      }
      expect(decision.faults.map(({ code, path }) => ({ code, path }))).toEqual([
        { code: 'FACT_LIMIT', path: '/values/80/value/136' },
      ]);
    },
  );

  test('prechecks every fact-array bound and aggregate before traversal', () => {
    const pipeline = branchPipeline();
    const input = {
      values: Array.from({ length: PIPELINE_LIMITS.facts.values + 1 }, () => ({
        key: 'choice',
        value: true,
      })),
      nodes: Array.from({ length: PIPELINE_LIMITS.facts.nodes + 1 }, () => ({
        key: 'choose',
        state: 'enabled' as const,
      })),
      candidateVerdicts: Array.from(
        { length: PIPELINE_LIMITS.facts.candidateVerdicts + 1 },
        () => ({ nodeKey: 'choose', candidate: 'candidate', verdict: 'approve' as const }),
      ),
      gateResolutions: Array.from({ length: PIPELINE_LIMITS.facts.gateResolutions + 1 }, () => ({
        nodeKey: 'choose',
        resolution: 'approve',
      })),
    } satisfies PipelineFacts;
    expect(decidePipeline(pipeline, input)).toMatchObject({
      kind: 'reject',
      faults: [
        { code: 'FACT_LIMIT', path: '' },
        { code: 'FACT_LIMIT', path: '/candidateVerdicts' },
        { code: 'FACT_LIMIT', path: '/gateResolutions' },
        { code: 'FACT_LIMIT', path: '/nodes' },
        { code: 'FACT_LIMIT', path: '/values' },
      ],
    });
  });

  test('reports exact candidate/gate shapes, duplicates, and RFC 6901 array paths', () => {
    const input = {
      ...emptyFacts(),
      candidateVerdicts: [
        { nodeKey: 'foreign', candidate: 'candidate', verdict: 'approve' },
        { nodeKey: 'foreign', candidate: 'candidate', verdict: 'approve' },
      ],
      gateResolutions: [
        { nodeKey: 'foreign', resolution: 'approve' },
        { nodeKey: 'foreign', resolution: 'approve' },
      ],
    } satisfies PipelineFacts;
    const decision = decidePipeline(branchPipeline(), input);
    expect(decision.kind).toBe('reject');
    if (decision.kind !== 'reject') {
      return;
    }
    expect(decision.faults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FACT_DUPLICATE', path: '/candidateVerdicts/1' }),
        expect.objectContaining({ code: 'FACT_DUPLICATE', path: '/gateResolutions/1' }),
        expect.objectContaining({ code: 'FACT_FOREIGN', path: '/candidateVerdicts/0/nodeKey' }),
        expect.objectContaining({ code: 'FACT_FOREIGN', path: '/gateResolutions/0/nodeKey' }),
      ]),
    );
  });

  test('preserves the portable inspector RFC 6901 path for a pruned depth fault', () => {
    let nested: unknown = true;
    for (let index = 0; index < PIPELINE_LIMITS.portable.depth; index += 1) {
      nested = { 'a/b~': nested };
    }
    const input: PipelineFacts = {
      ...emptyFacts(),
      values: [{ key: 'choice', value: true }],
    };
    Reflect.set(input.values[0]!, 'value', nested);
    const decision = decidePipeline(branchPipeline(), input);
    expect(decision.kind).toBe('reject');
    if (decision.kind !== 'reject') {
      return;
    }
    const depthFault = decision.faults.find(({ code }) => code === 'FACT_LIMIT');
    expect(depthFault?.path).toContain('/values/0/value/a~1b~0');
  });

  test('retains independent portable sibling faults with their exact paths', () => {
    const input: PipelineFacts = {
      ...emptyFacts(),
      values: [
        { key: 'choice', value: true },
        { key: 'choice', value: false },
      ],
    };
    Reflect.set(input.values[0]!, 'value', undefined);
    Reflect.set(input.values[1]!, 'value', () => true);
    const decision = decidePipeline(branchPipeline(), input);
    expect(decision.kind).toBe('reject');
    if (decision.kind !== 'reject') {
      return;
    }
    expect(decision.faults.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'FACT_TYPE', path: '/values/0/value' },
      { code: 'FACT_TYPE', path: '/values/1/value' },
    ]);
  });

  test('collects accessor, invalid, and foreign siblings in one globally bounded traversal', () => {
    const input: PipelineFacts = {
      ...emptyFacts(),
      values: [
        { key: 'choice', value: true },
        { key: 'choice', value: false },
        { key: 'foreign', value: true },
      ],
    };
    let reads = 0;
    Object.defineProperty(input.values, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        reads += 1;
        throw new Error('fact getter invoked');
      },
    });
    Reflect.set(input.values[1]!, 'value', () => true);
    const decision = decidePipeline(branchPipeline(), input);
    expect(reads).toBe(0);
    expect(decision.kind).toBe('reject');
    if (decision.kind !== 'reject') {
      return;
    }
    expect(decision.faults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FACT_TYPE', path: '/values/0' }),
        expect.objectContaining({ code: 'FACT_TYPE', path: '/values/1/value' }),
        expect.objectContaining({ code: 'FACT_FOREIGN', path: '/values/2/key' }),
      ]),
    );
  });

  test('returns the globally first 99 faults and root truncation sentinel', () => {
    const input = {
      ...emptyFacts(),
      values: Array.from({ length: 101 }, (_entry, index) => ({
        key: `foreign-${index}`,
        value: true,
      })),
    };
    const decision = decidePipeline(branchPipeline(), input);
    expect(decision.kind).toBe('reject');
    if (decision.kind !== 'reject') {
      return;
    }
    expect(decision.faults).toHaveLength(100);
    expect(decision.faults[99]).toEqual({
      code: 'FACT_LIMIT',
      path: '',
      message: 'Fault limit exceeded.',
    });
  });
});

describe('pruned transition inputs', () => {
  test('preserves the original node source index after a portable-invalid sibling', () => {
    const input = emptyFacts();
    Reflect.set(input, 'nodes', [null, { key: 'yes', state: 'enabled' }]);

    const decision = decidePipeline(branchPipeline(), input);

    expect(decision).toEqual({
      kind: 'reject',
      faults: [
        { code: 'FACT_TYPE', path: '/nodes/0', message: 'Invalid node fact.' },
        {
          code: 'FACT_CAUSAL',
          path: '/nodes/1',
          message: 'Node fact has no activation cause.',
        },
      ],
    });
  });

  test('rejects locally invalid and duplicate records without downstream fact cascades', () => {
    const input = emptyFacts();
    Reflect.set(input, 'nodes', [
      { key: 'choose', state: 'enabled' },
      { key: 'choose', state: 'terminal', outcome: 'true' },
    ]);

    const decision = decidePipeline(branchPipeline(), input);

    expect(decision).toEqual({
      kind: 'reject',
      faults: [
        {
          code: 'FACT_DUPLICATE',
          path: '/nodes/1/key',
          message: 'Duplicate node fact.',
        },
      ],
    });
  });

  test.each([
    ['nodes', [null]],
    ['nodes', [{ key: 'missing' }]],
    ['nodes', [{ kind: 'consensus' }]],
    ['facts', [null]],
    ['edges', [null]],
    ['incomingIndex', [null]],
  ] as const)(
    'returns only PIPELINE_INVALID for plain malformed compiled input %#',
    (key, value) => {
      const malformed = structuredClone(branchPipeline());
      Reflect.set(malformed, key, value);

      expect(() => decidePipeline(malformed, emptyFacts())).not.toThrow();
      expect(decidePipeline(malformed, emptyFacts())).toEqual({
        kind: 'reject',
        faults: [{ code: 'PIPELINE_INVALID', path: '', message: 'Compiled pipeline is invalid.' }],
      });
    },
  );
});
