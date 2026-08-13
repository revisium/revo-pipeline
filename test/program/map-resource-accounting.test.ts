import { describe, expect, it } from 'vitest';

import type { JsonValue } from '../../src/foundation/index.js';
import { analyzeProgram } from '../../src/program/index.js';
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
});
