import {
  appendJsonPointer,
  compareUnicodeCodePoints,
  readJsonPointer,
  type JsonPointer,
  type JsonValue,
} from '../../../foundation/index.js';
import type { ProgramMapNode } from '../../../program/index.js';
import { resolveSelector, type SelectorEnvironment } from '../selectors.js';
import {
  constructItemInputs,
  isItemList,
  validateItemInputs,
  type KeyedItem,
  type MapItemDescriptor,
  type MapPreflightCounters,
} from './map-preflight.js';

export const resolveMapItems = (
  node: ProgramMapNode,
  environment: SelectorEnvironment,
  expectedLength: number,
  counters?: MapPreflightCounters,
): readonly JsonValue[] | null => {
  if (counters !== undefined) {
    counters.itemsSelections += 1;
  }
  const selected = resolveSelector(node.items, environment);
  return expectedLength <= node.maximumItems &&
    selected.ok &&
    Array.isArray(selected.value) &&
    selected.value.length === expectedLength
    ? selected.value
    : null;
};

export const sourceIndexFor = (
  owner: {
    readonly itemKeys: readonly string[];
    readonly itemSourceIndexes: readonly number[];
  },
  itemKey: string,
  counters?: MapPreflightCounters,
): number | null => {
  let lower = 0;
  let upper = owner.itemKeys.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const candidate = owner.itemKeys[middle];
    if (candidate === undefined) {
      return null;
    }
    if (counters !== undefined) {
      counters.sourceIndexComparisons += 1;
    }
    const order = compareUnicodeCodePoints(candidate, itemKey);
    if (order === 0) {
      return owner.itemSourceIndexes[middle] ?? null;
    }
    if (order < 0) {
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return null;
};

const descriptorFrom = (
  node: ProgramMapNode,
  environment: SelectorEnvironment,
  item: KeyedItem,
  counters?: MapPreflightCounters,
): MapItemDescriptor | null => {
  const descriptors = constructItemInputs(node, [item], environment, counters);
  if (
    !isItemList(descriptors) ||
    validateItemInputs(node, descriptors, [item], counters) !== null
  ) {
    return null;
  }
  return descriptors[0] ?? null;
};

export const reconstructMapItem = (
  node: ProgramMapNode,
  environment: SelectorEnvironment,
  items: readonly JsonValue[],
  itemKey: string,
  sourceIndex: number,
  counters?: MapPreflightCounters,
): MapItemDescriptor | null => {
  if (counters !== undefined) {
    counters.targetedBuilds += 1;
  }
  const item = items[sourceIndex];
  if (item === undefined) {
    return null;
  }
  const itemPath = appendJsonPointer(
    node.items.kind === 'literal' ? '' : node.items.pointer,
    String(sourceIndex),
  );
  const itemKeyPath = `${itemPath}${node.itemKeyPointer}` as JsonPointer;
  const lookup = readJsonPointer(item, node.itemKeyPointer);
  if (counters !== undefined) {
    counters.keyPointerReads += 1;
  }
  if (!lookup.found || lookup.value !== itemKey) {
    return null;
  }
  return descriptorFrom(
    node,
    environment,
    { index: sourceIndex, itemKey, item, itemPath, itemKeyPath },
    counters,
  );
};
