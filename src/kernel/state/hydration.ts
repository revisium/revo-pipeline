import { Compile } from 'typebox/compile';

import {
  PIPELINE_LIMITS,
  compareUnicodeCodePoints,
  normalizeOwnedEnvelope,
  type JsonPointer,
} from '../../foundation/index.js';
import type { MachineFrame } from '../contracts/frames.js';
import { PipelineStateSchema, type PipelineState } from '../contracts/state.js';

const stateValidator = Compile(PipelineStateSchema);

const nodeResultsPath = /^\/frames\/(?:0|[1-9]\d*)\/nodeResults$/u;

const machineObjectLimit = (path: JsonPointer): number =>
  nodeResultsPath.test(path)
    ? PIPELINE_LIMITS.sourcePackage.nodes
    : PIPELINE_LIMITS.portableValue.objectKeys;

const isStrictlySorted = <Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (
      previous === undefined ||
      current === undefined ||
      compareUnicodeCodePoints(key(previous), key(current)) >= 0
    ) {
      return false;
    }
  }
  return true;
};

const hasCanonicalFrameArrays = (frame: MachineFrame): boolean => {
  if (!isStrictlySorted(Object.keys(frame.nodeResults), (nodeId) => nodeId)) {
    return false;
  }
  if (
    (frame.kind === 'rootRegion' ||
      frame.kind === 'callRegion' ||
      frame.kind === 'parallelBranch' ||
      frame.kind === 'repeatBody' ||
      frame.kind === 'mapItem') &&
    !isStrictlySorted(frame.ready, (nodeId) => nodeId)
  ) {
    return false;
  }
  return frame.kind !== 'map'
    ? true
    : isStrictlySorted(frame.itemKeys, (key) => key) &&
        isStrictlySorted(frame.pendingItemKeys, (key) => key) &&
        isStrictlySorted(frame.activeItemKeys, (key) => key) &&
        isStrictlySorted(frame.completedItems, ({ itemKey }) => itemKey);
};

const hasCanonicalStateArrays = (state: PipelineState): boolean =>
  isStrictlySorted(state.frames, ({ key }) => key) &&
  isStrictlySorted(state.pending, ({ commandKey }) => commandKey) &&
  isStrictlySorted(state.resolved, ({ commandKey }) => commandKey) &&
  isStrictlySorted(state.runCancellation?.awaiting ?? [], (key) => key) &&
  isStrictlySorted(state.regionCancellations, ({ frameKey }) => frameKey) &&
  state.regionCancellations.every(({ awaiting }) => isStrictlySorted(awaiting, (key) => key)) &&
  state.frames.every(hasCanonicalFrameArrays);

const hasConsistentStateStatus = (state: PipelineState): boolean => {
  const terminal =
    state.status === 'succeeded' || state.status === 'failed' || state.status === 'cancelled';
  const pendingKeys = new Set(state.pending.map(({ commandKey }) => commandKey));
  return (
    (state.status === 'cancelling') === (state.runCancellation !== null) &&
    (!terminal ||
      (state.frames.length === 0 &&
        state.pending.length === 0 &&
        state.resolved.length === 0 &&
        state.regionCancellations.length === 0)) &&
    !state.resolved.some(({ commandKey }) => pendingKeys.has(commandKey))
  );
};

export const hydratePipelineState = (input: unknown): PipelineState | null => {
  const owned = normalizeOwnedEnvelope(
    input,
    PIPELINE_LIMITS.sourcePackage.totalActivities,
    machineObjectLimit,
  );
  return owned.ok &&
    stateValidator.Check(owned.value) &&
    hasCanonicalStateArrays(owned.value) &&
    hasConsistentStateStatus(owned.value)
    ? owned.value
    : null;
};
