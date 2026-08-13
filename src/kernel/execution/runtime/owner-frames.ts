import type { Digest, JsonValue } from '../../../foundation/index.js';
import type {
  ProgramMapNode,
  ProgramParallelNode,
  ProgramRepeatNode,
} from '../../../program/index.js';
import type {
  MapMachineFrame,
  ParallelMachineFrame,
  RepeatMachineFrame,
} from '../../contracts/structured-frames.js';
import { computeFrameKey } from '../../identity/digests.js';
import type { MapItemDescriptor } from './map-preflight.js';

const emptyRecord = () => Object.freeze({});
const emptyArray = () => Object.freeze([]);

export const createParallelOwner = (
  parentFrameKey: Digest,
  scopeInput: JsonValue,
  node: ProgramParallelNode,
): ParallelMachineFrame | null => {
  const key = computeFrameKey({ kind: 'parallel', parentFrameKey, nodeId: node.id });
  if (key === null) {
    return null;
  }
  const base = {
    kind: 'parallel' as const,
    key,
    parentFrameKey,
    scopeInput,
    nodeResults: emptyRecord(),
    nodeId: node.id,
    branchRegionKeys: emptyRecord(),
    status: 'active' as const,
  };
  return node.mode === 'generic'
    ? Object.freeze({ ...base, mode: 'generic', branchResults: emptyRecord(), selected: null })
    : Object.freeze({ ...base, mode: 'votes', branchResults: emptyRecord(), selected: null });
};

export const createRepeatOwner = (
  parentFrameKey: Digest,
  scopeInput: JsonValue,
  node: ProgramRepeatNode,
): RepeatMachineFrame | null => {
  const key = computeFrameKey({ kind: 'repeat', parentFrameKey, nodeId: node.id });
  return key === null
    ? null
    : Object.freeze({
        kind: 'repeat',
        key,
        parentFrameKey,
        scopeInput,
        nodeResults: emptyRecord(),
        nodeId: node.id,
        iteration: 0,
        bodyRegionKey: null,
        bodyResult: null,
        previousOutput: null,
        status: 'active',
      });
};

export const createMapOwner = (
  parentFrameKey: Digest,
  scopeInput: JsonValue,
  node: ProgramMapNode,
  descriptors: readonly MapItemDescriptor[],
): MapMachineFrame | null => {
  const key = computeFrameKey({ kind: 'map', parentFrameKey, nodeId: node.id });
  return key === null
    ? null
    : Object.freeze({
        kind: 'map',
        key,
        parentFrameKey,
        scopeInput,
        nodeResults: emptyRecord(),
        nodeId: node.id,
        itemKeys: Object.freeze(descriptors.map(({ itemKey }) => itemKey)),
        itemSourceIndexes: Object.freeze(descriptors.map(({ index }) => index)),
        pendingItemKeys: Object.freeze(descriptors.map(({ itemKey }) => itemKey)),
        activeItemKeys: emptyArray(),
        completedItems: emptyArray(),
        status: 'active',
        selected: null,
        selectedFailureItemKey: null,
      });
};
