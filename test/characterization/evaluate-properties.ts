import { createHash } from 'node:crypto';

import { compilePipeline, decidePipeline, decodeCompiledPipeline } from '../../src/index.js';
import type { PipelineDefinition, PipelineFacts } from '../../src/index.js';
const validateCompiledPipeline = (input: unknown) => {
  const decoded = decodeCompiledPipeline(input);
  return decoded.ok ? decoded : { ok: false as const };
};

type PropertyResult = { readonly id: string; readonly output: unknown };

const linear = (): PipelineDefinition => ({
  schemaVersion: 1,
  entry: 'start',
  facts: [],
  nodes: [
    {
      kind: 'task',
      key: 'start',
      outcomes: { cancelled: 'end', completed: 'end', failed: 'end', skipped: 'end' },
    },
    { kind: 'terminal', key: 'end', outcome: 'done' },
  ],
});

const emptyFacts = (): PipelineFacts => ({
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
});

const compiledLinear = () => {
  const result = compilePipeline(linear());
  if (!result.ok) {
    throw new Error('Property fixture failed to compile');
  }
  return result.pipeline;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const frozenObjectCount = (value: unknown, seen = new Set<object>()): number => {
  if (!isObject(value) || seen.has(value)) {
    return 0;
  }
  seen.add(value);
  return (
    Number(Object.isFrozen(value)) +
    Object.values(value).reduce(
      (count: number, nested: unknown) => count + frozenObjectCount(nested, seen),
      0,
    )
  );
};

const objectCount = (value: unknown, seen = new Set<object>()): number => {
  if (!isObject(value) || seen.has(value)) {
    return 0;
  }
  seen.add(value);
  return (
    1 +
    Object.values(value).reduce(
      (count: number, nested: unknown) => count + objectCount(nested, seen),
      0,
    )
  );
};

const evaluateNoopReachability = (): unknown => {
  const pipeline = compiledLinear();
  const variants = [
    [
      undefined,
      { key: 'start', state: 'enabled' },
      { key: 'start', state: 'terminal', outcome: 'completed' },
    ],
    [
      undefined,
      { key: 'end', state: 'enabled' },
      { key: 'end', state: 'terminal', outcome: 'done' },
    ],
  ] as const;
  const counts: Record<string, number> = {};
  const records: unknown[] = [];
  for (const start of variants[0]) {
    for (const end of variants[1]) {
      const facts = {
        ...emptyFacts(),
        nodes: [start, end].filter((fact) => fact !== undefined),
      } as PipelineFacts;
      const decision = decidePipeline(pipeline, facts);
      if (
        decision.kind === 'noop' ||
        (decision.kind === 'activate' && decision.nodeKeys.length === 0)
      ) {
        throw new Error('Noop or empty activation reached in bounded valid state matrix');
      }
      const kind = decision.kind;
      counts[kind] = (counts[kind] ?? 0) + 1;
      records.push({ facts, decision });
    }
  }
  return {
    fixture: 'linear-task-terminal',
    dimensions: {
      start: ['absent', 'enabled', 'terminal-completed'],
      end: ['absent', 'enabled', 'terminal-done'],
    },
    combinations: 9,
    matrixSha256: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
    decisionKindCounts: Object.fromEntries(
      Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
    ),
    noopReachable: (counts.noop ?? 0) > 0,
    conclusion: 'No noop decision is reachable in this exhaustive bounded valid state matrix.',
  };
};

const evaluators: Readonly<Record<string, () => unknown>> = {
  'descriptor-definition-getter': () => {
    let invocations = 0;
    const hostile = {};
    Object.defineProperties(hostile, {
      schemaVersion: { value: 1, enumerable: true },
      entry: { value: 'end', enumerable: true },
      facts: { value: [], enumerable: true },
      nodes: {
        get: () => {
          invocations += 1;
          return [];
        },
        enumerable: true,
      },
    });
    const result: unknown = Reflect.apply(compilePipeline, undefined, [hostile]);
    return {
      getterInvocations: invocations,
      result,
    };
  },
  'descriptor-compiled-getter': () => {
    let invocations = 0;
    const hostile = {};
    Object.defineProperty(hostile, 'nodes', {
      get: () => {
        invocations += 1;
        return [];
      },
      enumerable: true,
    });
    const result = validateCompiledPipeline(hostile);
    return { getterInvocations: invocations, result };
  },
  'json-roundtrip': () => {
    const pipeline = compiledLinear();
    return validateCompiledPipeline(JSON.parse(JSON.stringify(pipeline)));
  },
  'deep-freeze': () => {
    const pipeline = compiledLinear();
    const objects = objectCount(pipeline);
    const frozenObjects = frozenObjectCount(pipeline);
    return {
      deeplyFrozen: frozenObjects === objects,
      frozenObjectCount: frozenObjects,
      objectCount: objects,
    };
  },
  'mutation-isolation': () => {
    const definition = linear();
    const result = compilePipeline(definition);
    if (!result.ok) {
      return result;
    }
    const before = JSON.stringify(result.pipeline);
    const first = definition.nodes[0];
    Reflect.set(definition.nodes, 0, definition.nodes[1]);
    Reflect.set(definition.nodes, 1, first);
    return { unchanged: JSON.stringify(result.pipeline) === before };
  },
  'source-permutation': () => {
    const definition = linear();
    return {
      equal:
        JSON.stringify(compilePipeline(definition)) ===
        JSON.stringify(compilePipeline({ ...definition, nodes: [...definition.nodes].reverse() })),
    };
  },
  'fact-permutation': () => {
    const pipeline = compiledLinear();
    const facts: PipelineFacts = {
      ...emptyFacts(),
      nodes: [
        { key: 'start', state: 'terminal', outcome: 'completed' },
        { key: 'end', state: 'enabled' },
      ],
    };
    return {
      equal:
        JSON.stringify(decidePipeline(pipeline, facts)) ===
        JSON.stringify(decidePipeline(pipeline, { ...facts, nodes: [...facts.nodes].reverse() })),
    };
  },
  'definition-bound': () =>
    compilePipeline({
      schemaVersion: 1,
      entry: 'missing',
      facts: [],
      nodes: Array.from({ length: 257 }, (_, index) => ({
        kind: 'terminal' as const,
        key: `node-${index}`,
        outcome: 'done',
      })),
    }),
  'fault-truncation-99-plus-sentinel': () => {
    const result = compilePipeline({
      schemaVersion: 1,
      entry: 'missing',
      facts: [],
      nodes: Array.from({ length: 101 }, () => ({
        kind: 'terminal' as const,
        key: 'duplicate',
        outcome: 'done',
      })),
    });
    return result.ok
      ? result
      : { faultCount: result.faults.length, first: result.faults[0], last: result.faults.at(-1) };
  },
  'decision-replay': () => {
    const pipeline = compiledLinear();
    const facts = emptyFacts();
    const first = decidePipeline(pipeline, facts);
    return {
      equal: JSON.stringify(first) === JSON.stringify(decidePipeline(pipeline, facts)),
      decision: first,
    };
  },
  'noop-reachability': evaluateNoopReachability,
};

export const evaluateProperties = (ids: readonly string[]): readonly PropertyResult[] =>
  ids.map((id) => {
    const evaluate = evaluators[id];
    if (!evaluate) {
      throw new Error(`Unknown characterization property: ${id}`);
    }
    return { id, output: evaluate() };
  });
