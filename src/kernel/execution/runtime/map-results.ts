import { type JsonValue, type PipelineFailure } from '../../../foundation/index.js';
import type { ProgramMapNode } from '../../../program/index.js';
import type { RegionTerminalResult } from '../../contracts/results.js';
import type { MapItemResult, MapMachineFrame } from '../../contracts/structured-frames.js';
import { findSorted, findSortedInsertionIndex } from '../../program/lookup.js';
import { readPipelineFailure } from './results.js';

export const toMapItemResult = (
  node: ProgramMapNode,
  itemKey: string,
  result: RegionTerminalResult,
): MapItemResult => {
  if (result.status === 'failed') {
    return Object.freeze({ itemKey, status: 'failed', output: null, failure: result.failure });
  }
  if (result.status === 'cancelled') {
    return Object.freeze({ itemKey, status: 'cancelled', output: null, failure: null });
  }
  const classification = node.bodyExits.find(
    ({ outcome }) => outcome === result.outcome,
  )?.classification;
  if (classification === 'failed') {
    return Object.freeze({
      itemKey,
      status: 'failed',
      output: null,
      failure: readPipelineFailure(result.output),
    });
  }
  if (classification === 'cancelled') {
    return Object.freeze({ itemKey, status: 'cancelled', output: null, failure: null });
  }
  return Object.freeze({ itemKey, status: 'succeeded', output: result.output, failure: null });
};

export const insertMapItemResult = (
  values: readonly MapItemResult[],
  value: MapItemResult,
): readonly MapItemResult[] => {
  const insertion = findSortedInsertionIndex(values, value.itemKey, ({ itemKey }) => itemKey);
  return Object.freeze([...values.slice(0, insertion), value, ...values.slice(insertion)]);
};

export const projectMapItems = (items: readonly MapItemResult[]): JsonValue =>
  Object.freeze(
    items.map((item) =>
      Object.freeze({
        itemKey: item.itemKey,
        status: item.status,
        output: item.output,
        errorCode: item.status === 'failed' ? (item.failure?.code ?? null) : null,
      }),
    ),
  );

export const findSelectedMapFailure = (owner: MapMachineFrame): PipelineFailure | null => {
  const key = owner.selectedFailureItemKey;
  const item =
    key === null ? null : findSorted(owner.completedItems, key, ({ itemKey }) => itemKey);
  return item?.status === 'failed' && item.failure !== null ? item.failure : null;
};
