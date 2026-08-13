import { describe, expect, it } from 'vitest';

import type { JsonValue } from '../../src/foundation/index.js';
import { analyzeProgram, type ProgramMapNode } from '../../src/program/index.js';
import { reverseNestedKeyMapProgram } from '../support/large-map-builders.js';

const jsonOccurrences = (value: JsonValue): number => {
  if (typeof value !== 'object' || value === null) {
    return 1;
  }
  const children: readonly JsonValue[] = Array.isArray(value) ? value : Object.values(value);
  return 1 + children.reduce<number>((total, child) => total + jsonOccurrences(child), 0);
};

const isJsonObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const maximumMapOwnerShape = (
  itemCount: number,
  reachable = false,
  result: 'failed' | 'cancelled' = 'failed',
): JsonValue => {
  const keys = Array.from({ length: itemCount }, (_, index) => `item-${index}`);
  return {
    kind: 'map',
    key: 'frame',
    parentFrameKey: 'parent',
    scopeInput: null,
    nodeResults: {},
    nodeId: 'node',
    itemKeys: keys,
    itemSourceIndexes: keys.map((unusedKey, index) => index),
    pendingItemKeys: reachable ? [] : keys,
    activeItemKeys: reachable ? [] : keys,
    completedItems: keys.map((itemKey) =>
      result === 'failed'
        ? { itemKey, status: 'failed', output: null, failure: { code: 'FAILED', path: '' } }
        : { itemKey, status: 'cancelled', output: null, failure: null },
    ),
    status: 'active',
    selected: null,
    selectedFailureItemKey: null,
  };
};

const authorMapOutput = (itemCount: number, output: JsonValue): JsonValue => ({
  items: Array.from({ length: itemCount }, (_, index) => ({
    itemKey: `item-${index}`,
    status: 'succeeded',
    output,
    errorCode: null,
  })),
});

describe('map source-index resource accounting', () => {
  it('charges five slots and sixteen scalar owner-plus-retained values per item', () => {
    const one = analyzeProgram(reverseNestedKeyMapProgram(1).program).analysis.resources;
    const two = analyzeProgram(reverseNestedKeyMapProgram(2).program).analysis.resources;
    expect(two.collectionSlots - one.collectionSlots).toBe(5);
    expect(two.stateJsonValues - one.stateJsonValues).toBe(16);
  });

  it('admits the maximum 1,024-item indexed map within every resource cap', () => {
    const analysis = analyzeProgram(reverseNestedKeyMapProgram(1_024).program);
    expect(analysis.ok).toBe(true);
    expect(analysis.analysis.resources.collectionSlots).toBeLessThanOrEqual(262_144);
    expect(analysis.analysis.resources.stateJsonValues).toBeLessThanOrEqual(1_048_576);
  });

  it.each([0, 1, 2, 1_024])('pins the exact 11N+15 scalar schema capacity at N=%i', (count) => {
    expect(jsonOccurrences(maximumMapOwnerShape(count))).toBe(11 * count + 15);
    expect(jsonOccurrences(maximumMapOwnerShape(count, true))).toBe(9 * count + 15);
  });

  it('pins zero selected-failure delta', () => {
    const owner = maximumMapOwnerShape(1, true);
    if (!isJsonObject(owner)) {
      throw new TypeError('Expected map owner object.');
    }
    expect(jsonOccurrences({ ...owner, selectedFailureItemKey: 'item-0' })).toBe(
      jsonOccurrences(owner),
    );
    expect(
      jsonOccurrences(owner) - jsonOccurrences(maximumMapOwnerShape(1, true, 'cancelled')),
    ).toBe(2);
  });

  it.each([
    ['scalar', { type: 'null' as const }, 16],
    [
      'object',
      {
        type: 'object' as const,
        properties: { left: { type: 'string' as const }, right: { type: 'integer' as const } },
        required: ['left', 'right'],
        additionalProperties: false as const,
      },
      18,
    ],
    [
      'array',
      { type: 'array' as const, items: { type: 'string' as const }, minItems: 0, maxItems: 8 },
      30,
    ],
  ] as const)(
    'weights nested %s completed outputs in owner and retained phases',
    (_name, schema, slope) => {
      const one = analyzeProgram(reverseNestedKeyMapProgram(1, schema).program).analysis.resources;
      const two = analyzeProgram(reverseNestedKeyMapProgram(2, schema).program).analysis.resources;
      expect(two.stateJsonValues - one.stateJsonValues).toBe(slope);
    },
  );

  it.each([
    [null, 1],
    [{ left: 1, right: 2 }, 3],
    [[[1], [2]], 5],
  ] as const)('pins the retained author projection for output %#', (output, weight) => {
    const itemCount = 4;
    expect(jsonOccurrences(authorMapOutput(itemCount, output))).toBe(
      2 + itemCount * (4 + Math.max(1, weight)),
    );
  });

  it('preserves duplicate/max semantics with one completed-outcome and body-exit pass', () => {
    const bundle = reverseNestedKeyMapProgram(1);
    const module = bundle.program.modules[0];
    const base = module?.region.nodes.find(({ kind }) => kind === 'map');
    if (base?.kind !== 'map') {
      throw new TypeError('Expected a map node.');
    }
    if (module === undefined) {
      throw new TypeError('Expected a Program module.');
    }
    const resourcesFor = (map: ProgramMapNode) =>
      analyzeProgram({
        ...bundle.program,
        modules: [
          {
            ...module,
            region: { ...module.region, nodes: [map, ...module.region.nodes.slice(1)] },
          },
        ],
      }).analysis.resources;
    const trackedTuple = <Value, Tuple extends readonly [Value, ...Value[]]>(
      values: Tuple,
      read: () => void,
    ): Tuple =>
      new Proxy(values, {
        get(target, property, receiver): unknown {
          if (typeof property === 'string' && /^(?:0|[1-9]\d*)$/u.test(property)) {
            read();
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return value;
        },
      });
    const count = 1_024;
    const classifiedExits = Array.from({ length: count }, (_, index) => ({
      outcome: `outcome-${index}`,
      classification: 'completed' as const,
    }));
    const bodyExits = Array.from({ length: count }, (_, index) => ({
      outcome: `outcome-${index}`,
      outputSchema:
        index === count - 1
          ? ({
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
              additionalProperties: false,
            } as const)
          : ({ type: 'null' } as const),
    }));
    const reads = { classified: 0, body: 0 };
    const node: ProgramMapNode = {
      ...base,
      bodyExits: trackedTuple(
        [classifiedExits[0]!, ...classifiedExits.slice(1)],
        () => (reads.classified += 1),
      ),
      body: {
        ...base.body,
        exits: trackedTuple([bodyExits[0]!, ...bodyExits.slice(1)], () => (reads.body += 1)),
      },
    };
    const resources = resourcesFor(node);
    const duplicate = resourcesFor({
      ...node,
      bodyExits: [classifiedExits[0]!, ...classifiedExits.slice(1), classifiedExits.at(-1)!],
      body: {
        ...node.body,
        exits: [bodyExits[0]!, ...bodyExits.slice(1), bodyExits.at(-1)!],
      },
    });
    const scalar = resourcesFor({
      ...base,
      bodyExits: [classifiedExits[0]!, ...classifiedExits.slice(1)],
      body: {
        ...base.body,
        exits: [
          { outcome: bodyExits[0]!.outcome, outputSchema: { type: 'null' } },
          ...bodyExits.slice(1).map(({ outcome }) => ({
            outcome,
            outputSchema: { type: 'null' as const },
          })),
        ],
      },
    });

    expect(resources.stateJsonValues).toBeGreaterThan(scalar.stateJsonValues);
    expect(duplicate.stateJsonValues).toBe(resources.stateJsonValues);
    expect(reads).toEqual({ classified: count * 2, body: count * 2 });
  });
});
