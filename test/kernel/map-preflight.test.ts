import { describe, expect, it } from 'vitest';

import type { ProgramMapNode } from '../../src/program/index.js';
import {
  createMapPreflightIndex,
  preflightMap,
  reconstructMapItem,
  resolveMapItems,
  sourceIndexFor,
} from '../support/kernel-internal.js';
import { programNodeExamples } from '../support/program-builders.js';

const mapExample = (): ProgramMapNode => {
  const node = programNodeExamples().find(({ kind }) => kind === 'map');
  if (node?.kind !== 'map') {
    throw new TypeError('Expected map example.');
  }
  return node;
};

const environment = {
  moduleInput: {},
  scopeInput: {},
  nodeResults: {},
};

const failed = (node: ProgramMapNode) => {
  const result = preflightMap(node, environment);
  if (result.ok) {
    throw new TypeError('Expected map preflight failure.');
  }
  return result.failure;
};

describe('map complete preflight', () => {
  it('checks the items selection before key or mapping work', () => {
    const node = {
      ...mapExample(),
      items: { kind: 'scopeInput' as const, pointer: '/missing' as const },
      itemKeyPointer: '/missing' as const,
      bodyInput: {
        value: { kind: 'map' as const, value: 'item' as const, pointer: '/also-missing' as const },
      },
    };
    expect(failed(node)).toEqual({ code: 'DATA_POINTER_MISSING', path: '/missing' });
  });

  it('checks every item key before any mapped body input', () => {
    const node = {
      ...mapExample(),
      items: { kind: 'literal' as const, value: [{ id: 'a' }, {}] },
      itemKeyPointer: '/id' as const,
      bodyInput: {
        value: { kind: 'map' as const, value: 'item' as const, pointer: '/missing' as const },
      },
    };
    expect(failed(node)).toEqual({ code: 'DATA_POINTER_MISSING', path: '/1/id' });
  });

  it('checks key presence globally before key types', () => {
    expect(
      failed({
        ...mapExample(),
        items: { kind: 'literal', value: [{ id: 1 }, {}] },
        itemKeyPointer: '/id',
      }),
    ).toEqual({ code: 'DATA_POINTER_MISSING', path: '/1/id' });
  });

  it('checks key types globally before duplicates', () => {
    expect(
      failed({
        ...mapExample(),
        items: { kind: 'literal', value: [{ id: 'a' }, { id: 1 }, { id: 'a' }] },
        itemKeyPointer: '/id',
        maximumItems: 3,
      }),
    ).toEqual({ code: 'DATA_SCHEMA_MISMATCH', path: '/1/id' });
  });

  it('selects the lowest input index for duplicate and mapping failures', () => {
    expect(
      failed({
        ...mapExample(),
        items: { kind: 'literal', value: [{ id: 'same' }, { id: 'same' }] },
        itemKeyPointer: '/id',
      }),
    ).toEqual({ code: 'DATA_SCHEMA_MISMATCH', path: '/1/id' });

    expect(
      failed({
        ...mapExample(),
        items: { kind: 'literal', value: [{ id: 'z' }, { id: 'a' }] },
        itemKeyPointer: '/id',
        bodyInput: {
          z: { kind: 'map', value: 'item', pointer: '/z' },
          a: { kind: 'map', value: 'item', pointer: '/a' },
        },
      }),
    ).toEqual({ code: 'DATA_POINTER_MISSING', path: '/0/a' });
  });

  it('checks every mapping before any constructed input schema', () => {
    expect(
      failed({
        ...mapExample(),
        items: { kind: 'literal', value: [{ id: 'a', value: 1 }, { id: 'z' }] },
        itemKeyPointer: '/id',
        bodyInput: { value: { kind: 'map', value: 'item', pointer: '/value' } },
      }),
    ).toEqual({ code: 'DATA_POINTER_MISSING', path: '/1/value' });
  });

  it('selects the lowest input index for constructed input schema failures', () => {
    expect(
      failed({
        ...mapExample(),
        items: { kind: 'literal', value: [{ id: 'z' }, { id: 'a' }] },
        itemKeyPointer: '/id',
        bodyInput: { value: { kind: 'literal', value: 1 } },
      }),
    ).toEqual({ code: 'DATA_SCHEMA_MISMATCH', path: '/0' });
  });

  it('normalizes successful descriptors by Unicode item key', () => {
    const result = preflightMap(
      {
        ...mapExample(),
        items: { kind: 'literal', value: [{ id: 'z' }, { id: 'a' }] },
        itemKeyPointer: '/id',
        bodyInput: {},
      },
      environment,
    );
    expect(result.ok && result.descriptors.map(({ itemKey }) => itemKey)).toEqual(['a', 'z']);
  });

  it('preserves an own __proto__ body input key on an ordinary frozen record', () => {
    const result = preflightMap(
      {
        ...mapExample(),
        items: { kind: 'literal', value: [{ id: 'one' }] },
        itemKeyPointer: '/id',
        bodyInput: Object.fromEntries([['__proto__', { kind: 'literal' as const, value: 'safe' }]]),
        body: {
          ...mapExample().body,
          inputSchema: {
            type: 'object',
            properties: Object.fromEntries([['__proto__', { type: 'string' as const }]]),
            required: ['__proto__'],
            additionalProperties: false,
          },
        },
      },
      environment,
    );
    if (!result.ok) {
      throw new TypeError('Expected successful map preflight.');
    }
    const input = result.descriptors[0]?.input;
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new TypeError('Expected an object map input.');
    }
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(Object.hasOwn(input, '__proto__')).toBe(true);
    expect(Reflect.getOwnPropertyDescriptor(input, '__proto__')).toMatchObject({ value: 'safe' });
    expect(Object.isFrozen(input)).toBe(true);
  });

  it('builds and indexes one descriptor set per owner in a transition', () => {
    const counters = {
      builds: 0,
      targetedBuilds: 0,
      itemsSelections: 0,
      keyPointerReads: 0,
      mappingResolutions: 0,
      schemaChecks: 0,
      descriptorComparisons: 0,
      sourceIndexComparisons: 0,
      descriptorIndexes: 0,
      descriptorLookups: 0,
    };
    const index = createMapPreflightIndex(counters);
    const itemCount = 1_024;
    const node = {
      ...mapExample(),
      items: {
        kind: 'literal' as const,
        value: Array.from({ length: itemCount }, (_, ordinal) => ({ id: `item-${ordinal}` })),
      },
      itemKeyPointer: '/id' as const,
      maximumItems: itemCount,
      bodyInput: {},
    };
    const ownerKey = `sha256:${'f'.repeat(64)}` as const;
    const preflight = preflightMap(node, environment, counters);
    index.remember(ownerKey, preflight);
    expect(index.descriptor(ownerKey, 'item-512', () => null)?.itemKey).toBe('item-512');
    expect(counters).toMatchObject({
      builds: 1,
      targetedBuilds: 0,
      itemsSelections: 1,
      keyPointerReads: itemCount,
      schemaChecks: itemCount,
      descriptorIndexes: itemCount,
      descriptorLookups: 1,
    });
    expect(counters.descriptorComparisons).toBe(2_030);
    expect(counters.descriptorComparisons).toBeLessThan(itemCount * 20);

    const targeted = {
      builds: 0,
      targetedBuilds: 0,
      itemsSelections: 0,
      keyPointerReads: 0,
      mappingResolutions: 0,
      schemaChecks: 0,
      descriptorComparisons: 0,
      sourceIndexComparisons: 0,
      descriptorIndexes: 0,
      descriptorLookups: 0,
    };
    const resumed = createMapPreflightIndex(targeted);
    if (!preflight.ok) {
      throw new TypeError('Expected a successful complete preflight.');
    }
    const relation = {
      itemKeys: preflight.descriptors.map(({ itemKey }) => itemKey),
      itemSourceIndexes: preflight.descriptors.map(({ index: sourceIndex }) => sourceIndex),
    };
    const items = resolveMapItems(node, environment, itemCount, targeted);
    if (items === null) {
      throw new TypeError('Expected the runtime map items.');
    }
    const rebuild = (itemKey: string) => (measurement?: Parameters<typeof preflightMap>[2]) => {
      const sourceIndex = sourceIndexFor(relation, itemKey, measurement);
      return sourceIndex === null
        ? null
        : reconstructMapItem(node, environment, items, itemKey, sourceIndex, measurement);
    };
    expect(resumed.descriptor(ownerKey, 'item-512', rebuild('item-512'))?.itemKey).toBe('item-512');
    expect(resumed.descriptor(ownerKey, 'item-512', rebuild('item-512'))?.itemKey).toBe('item-512');
    expect(resumed.descriptor(ownerKey, 'item-513', rebuild('item-513'))?.itemKey).toBe('item-513');
    expect(resumed.descriptor(ownerKey, 'item-0', rebuild('item-0'))?.itemKey).toBe('item-0');
    expect(resumed.descriptor(ownerKey, 'item-999', rebuild('item-999'))?.itemKey).toBe('item-999');
    expect(targeted).toMatchObject({
      builds: 0,
      targetedBuilds: 4,
      itemsSelections: 1,
      keyPointerReads: 4,
      schemaChecks: 4,
      descriptorIndexes: 4,
      descriptorLookups: 5,
      descriptorComparisons: 0,
    });
    expect(targeted.sourceIndexComparisons).toBeLessThanOrEqual(44);
  });

  it('reconstructs every admitted item with logarithmic key lookup and no rescan', () => {
    const itemCount = 1_024;
    const node = {
      ...mapExample(),
      items: {
        kind: 'literal' as const,
        value: Array.from({ length: itemCount }, (_, ordinal) => ({ id: `item-${ordinal}` })),
      },
      itemKeyPointer: '/id' as const,
      maximumItems: itemCount,
      bodyInput: {},
    };
    const preflight = preflightMap(node, environment);
    if (!preflight.ok) {
      throw new TypeError('Expected a successful complete preflight.');
    }
    const counters = {
      builds: 0,
      targetedBuilds: 0,
      itemsSelections: 0,
      keyPointerReads: 0,
      mappingResolutions: 0,
      schemaChecks: 0,
      descriptorComparisons: 0,
      sourceIndexComparisons: 0,
      descriptorIndexes: 0,
      descriptorLookups: 0,
    };
    const relation = {
      itemKeys: preflight.descriptors.map(({ itemKey }) => itemKey),
      itemSourceIndexes: preflight.descriptors.map(({ index }) => index),
    };
    const items = resolveMapItems(node, environment, itemCount, counters);
    if (items === null) {
      throw new TypeError('Expected the runtime map items.');
    }
    for (const itemKey of relation.itemKeys) {
      const sourceIndex = sourceIndexFor(relation, itemKey, counters);
      expect(sourceIndex).not.toBeNull();
      expect(
        reconstructMapItem(node, environment, items, itemKey, sourceIndex ?? -1, counters),
      ).not.toBeNull();
    }
    expect(counters).toMatchObject({
      builds: 0,
      targetedBuilds: itemCount,
      itemsSelections: 1,
      keyPointerReads: itemCount,
      schemaChecks: itemCount,
      descriptorComparisons: 0,
    });
    expect(counters.sourceIndexComparisons).toBeLessThanOrEqual(itemCount * 11);
  });
});
