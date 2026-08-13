import {
  appendJsonPointer,
  compareUnicodeCodePoints,
  isJsonPointer,
  readJsonPointer,
  type JsonPointer,
  type JsonValue,
  type PipelineFailure,
} from '../../../foundation/index.js';
import type { ProgramMapNode, ProgramValueSelector } from '../../../program/index.js';
import type { SelectorEnvironment } from '../selectors.js';
import { resolveSelector, valueMatchesSchema } from '../selectors.js';

export type MapItemDescriptor = {
  readonly index: number;
  readonly itemKey: string;
  readonly item: JsonValue;
  readonly input: JsonValue;
};

export type MapPreflightResult =
  | { readonly ok: true; readonly descriptors: readonly MapItemDescriptor[] }
  | { readonly ok: false; readonly failure: PipelineFailure };

export type MapPreflightCounters = {
  builds: number;
  targetedBuilds: number;
  itemsSelections: number;
  keyPointerReads: number;
  mappingResolutions: number;
  schemaChecks: number;
  descriptorComparisons: number;
  sourceIndexComparisons: number;
};

const failed = (code: string, path: JsonPointer): MapPreflightResult =>
  Object.freeze({ ok: false, failure: Object.freeze({ code, path }) });

const selectorPath = (selector: ProgramValueSelector): JsonPointer =>
  selector.kind === 'literal' ? '' : selector.pointer;

const mappedFailurePath = (
  selector: ProgramValueSelector,
  itemPath: JsonPointer,
  itemKeyPath: JsonPointer,
): JsonPointer => {
  if (selector.kind !== 'map') {
    return selectorPath(selector);
  }
  const base = selector.value === 'item' ? itemPath : itemKeyPath;
  const combined = `${base}${selector.pointer}`;
  return selector.pointer === '' || !isJsonPointer(combined) ? base : combined;
};

export type KeyedItem = {
  readonly index: number;
  readonly itemKey: string;
  readonly item: JsonValue;
  readonly itemPath: JsonPointer;
  readonly itemKeyPath: JsonPointer;
};

type LocatedItem = Omit<KeyedItem, 'itemKey'> & { readonly itemKey: unknown };

const locateItemKeys = (
  node: ProgramMapNode,
  items: readonly JsonValue[],
  itemsPath: JsonPointer,
  counters?: MapPreflightCounters,
): readonly LocatedItem[] | MapPreflightResult => {
  const located: LocatedItem[] = [];
  for (const [index, item] of items.entries()) {
    const itemPath = appendJsonPointer(itemsPath, String(index));
    const itemKeyPath = `${itemPath}${node.itemKeyPointer}` as JsonPointer;
    const lookup = readJsonPointer(item, node.itemKeyPointer);
    if (counters !== undefined) {
      counters.keyPointerReads += 1;
    }
    if (!lookup.found) {
      return failed('DATA_POINTER_MISSING', itemKeyPath);
    }
    located.push({ index, itemKey: lookup.value, item, itemPath, itemKeyPath });
  }
  return located;
};

export const isItemList = <Item>(
  value: readonly Item[] | MapPreflightResult,
): value is readonly Item[] => Array.isArray(value);

const requireStringKeys = (
  located: readonly LocatedItem[],
): readonly KeyedItem[] | MapPreflightResult => {
  const keyed: KeyedItem[] = [];
  for (const item of located) {
    if (typeof item.itemKey !== 'string') {
      return failed('DATA_SCHEMA_MISMATCH', item.itemKeyPath);
    }
    keyed.push({ ...item, itemKey: item.itemKey });
  }
  return keyed;
};

const requireUniqueKeys = (items: readonly KeyedItem[]): MapPreflightResult | null => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.itemKey)) {
      return failed('DATA_SCHEMA_MISMATCH', item.itemKeyPath);
    }
    seen.add(item.itemKey);
  }
  return null;
};

export const constructItemInputs = (
  node: ProgramMapNode,
  items: readonly KeyedItem[],
  parent: SelectorEnvironment,
  counters?: MapPreflightCounters,
): readonly MapItemDescriptor[] | MapPreflightResult => {
  const descriptors: MapItemDescriptor[] = [];
  const entries = Object.entries(node.bodyInput).sort(([left], [right]) =>
    compareUnicodeCodePoints(left, right),
  );
  for (const item of items) {
    const environment: SelectorEnvironment = {
      ...parent,
      map: { item: item.item, itemKey: item.itemKey },
    };
    const input: Record<string, JsonValue> = {};
    for (const [key, selector] of entries) {
      const resolution = resolveSelector(selector, environment);
      if (counters !== undefined) {
        counters.mappingResolutions += 1;
      }
      if (!resolution.ok) {
        return failed(
          'DATA_POINTER_MISSING',
          mappedFailurePath(selector, item.itemPath, item.itemKeyPath),
        );
      }
      input[key] = resolution.value;
    }
    descriptors.push(
      Object.freeze({
        index: item.index,
        itemKey: item.itemKey,
        item: item.item,
        input: Object.freeze(input),
      }),
    );
  }
  return descriptors;
};

export const validateItemInputs = (
  node: ProgramMapNode,
  descriptors: readonly MapItemDescriptor[],
  items: readonly KeyedItem[],
  counters?: MapPreflightCounters,
): MapPreflightResult | null => {
  for (const [index, descriptor] of descriptors.entries()) {
    if (counters !== undefined) {
      counters.schemaChecks += 1;
    }
    if (!valueMatchesSchema(node.body.inputSchema, descriptor.input)) {
      return failed('DATA_SCHEMA_MISMATCH', items[index]?.itemPath ?? '');
    }
  }
  return null;
};

export const preflightMap = (
  node: ProgramMapNode,
  environment: SelectorEnvironment,
  counters?: MapPreflightCounters,
): MapPreflightResult => {
  if (counters !== undefined) {
    counters.builds += 1;
    counters.itemsSelections += 1;
  }
  const itemsPath = selectorPath(node.items);
  const selected = resolveSelector(node.items, environment);
  if (!selected.ok) {
    return failed('DATA_POINTER_MISSING', itemsPath);
  }
  if (!Array.isArray(selected.value) || selected.value.length > node.maximumItems) {
    return failed('DATA_SCHEMA_MISMATCH', itemsPath);
  }
  const located = locateItemKeys(node, selected.value, itemsPath, counters);
  if (!isItemList(located)) {
    return located;
  }
  const keyed = requireStringKeys(located);
  if (!isItemList(keyed)) {
    return keyed;
  }
  const duplicate = requireUniqueKeys(keyed);
  if (duplicate !== null) {
    return duplicate;
  }
  const descriptors = constructItemInputs(node, keyed, environment, counters);
  if (!isItemList(descriptors)) {
    return descriptors;
  }
  const invalidInput = validateItemInputs(node, descriptors, keyed, counters);
  if (invalidInput !== null) {
    return invalidInput;
  }
  return Object.freeze({
    ok: true,
    descriptors: Object.freeze(
      [...descriptors].sort((left, right) => {
        if (counters !== undefined) {
          counters.descriptorComparisons += 1;
        }
        return compareUnicodeCodePoints(left.itemKey, right.itemKey);
      }),
    ),
  });
};
