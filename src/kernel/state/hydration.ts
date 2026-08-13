import { Compile } from 'typebox/compile';

import {
  PIPELINE_LIMITS,
  compareUnicodeCodePoints,
  normalizeOwnedEnvelope,
  type Digest,
  type JsonPointer,
} from '../../foundation/index.js';
import type { MachineFrame } from '../contracts/frames.js';
import { PipelineStateSchema, type PipelineState } from '../contracts/state.js';
import type { MapItemResult, MapMachineFrame } from '../contracts/structured-frames.js';
import { stateFitsMachineLimits } from './bounds.js';

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

const findMapItem = (values: readonly MapItemResult[], key: string): MapItemResult | null => {
  let lower = 0;
  let upper = values.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const value = values[middle];
    if (value === undefined) {
      return null;
    }
    const order = compareUnicodeCodePoints(value.itemKey, key);
    if (order === 0) {
      return value;
    }
    if (order < 0) {
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return null;
};

const hasConsistentSelectedMapFailure = (frame: MapMachineFrame): boolean => {
  const key = frame.selectedFailureItemKey;
  if ((frame.selected === 'failed') !== (key !== null)) {
    return false;
  }
  if (key === null) {
    return true;
  }
  const selected = findMapItem(frame.completedItems, key);
  return (
    frame.itemKeys.includes(key) &&
    !frame.pendingItemKeys.includes(key) &&
    !frame.activeItemKeys.includes(key) &&
    selected?.status === 'failed' &&
    selected.output === null &&
    selected.failure !== null
  );
};

const hasCompleteItemPartition = (frame: MapMachineFrame): boolean => {
  if (
    frame.pendingItemKeys.length + frame.activeItemKeys.length + frame.completedItems.length !==
    frame.itemKeys.length
  ) {
    return false;
  }
  const remaining = new Set(frame.itemKeys);
  const consume = (key: string): boolean => remaining.delete(key);
  return (
    frame.pendingItemKeys.every(consume) &&
    frame.activeItemKeys.every(consume) &&
    frame.completedItems.every(({ itemKey }) => consume(itemKey)) &&
    remaining.size === 0
  );
};

const hasSourceIndexPermutation = (frame: MapMachineFrame): boolean => {
  if (frame.itemSourceIndexes.length !== frame.itemKeys.length) {
    return false;
  }
  const seen = new Set<number>();
  for (const index of frame.itemSourceIndexes) {
    if (index < 0 || index >= frame.itemKeys.length || seen.has(index)) {
      return false;
    }
    seen.add(index);
  }
  return seen.size === frame.itemKeys.length;
};

const hasConsistentMapItemResults = (frame: MapMachineFrame): boolean =>
  frame.completedItems.every((item) => {
    if (item.status === 'succeeded') {
      return item.failure === null;
    }
    if (item.status === 'failed') {
      return item.output === null && item.failure !== null;
    }
    return item.output === null && item.failure === null;
  });

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
        isStrictlySorted(frame.completedItems, ({ itemKey }) => itemKey) &&
        hasConsistentMapItemResults(frame) &&
        hasSourceIndexPermutation(frame) &&
        hasCompleteItemPartition(frame) &&
        hasConsistentSelectedMapFailure(frame);
};

const hasCanonicalStateArrays = (state: PipelineState): boolean =>
  isStrictlySorted(state.frames, ({ key }) => key) &&
  isStrictlySorted(state.pending, ({ commandKey }) => commandKey) &&
  isStrictlySorted(state.resolved, ({ commandKey }) => commandKey) &&
  isStrictlySorted(state.runCancellation?.awaiting ?? [], (key) => key) &&
  isStrictlySorted(state.regionCancellations, ({ frameKey }) => frameKey) &&
  state.regionCancellations.every(({ awaiting }) => isStrictlySorted(awaiting, (key) => key)) &&
  state.frames.every(hasCanonicalFrameArrays);

const hasConsistentCancellationOwners = (state: PipelineState): boolean => {
  const frames = new Map(state.frames.map((frame) => [frame.key, frame]));
  const pending = new Map(state.pending.map((operation) => [operation.commandKey, operation]));
  const ownersByCommand = new Map<Digest, Digest[]>();
  for (const cancellation of state.regionCancellations) {
    const owner = frames.get(cancellation.frameKey);
    if ((owner?.kind !== 'parallel' && owner?.kind !== 'map') || owner.selected === null) {
      return false;
    }
    for (const commandKey of cancellation.awaiting) {
      const owners = ownersByCommand.get(commandKey) ?? [];
      owners.push(cancellation.frameKey);
      ownersByCommand.set(commandKey, owners);
    }
  }
  for (const [commandKey, ownerKeys] of ownersByCommand) {
    const operation = pending.get(commandKey);
    if (operation === undefined) {
      return false;
    }
    const remaining = new Set(ownerKeys);
    let frame = frames.get(operation.ref.frameKey);
    for (let depth = 0; frame !== undefined && depth <= 64; depth += 1) {
      remaining.delete(frame.key);
      frame = frame.parentFrameKey === null ? undefined : frames.get(frame.parentFrameKey);
    }
    if (remaining.size > 0) {
      return false;
    }
  }
  return true;
};

const hasConsistentStateStatus = (state: PipelineState): boolean => {
  const terminal =
    state.status === 'succeeded' || state.status === 'failed' || state.status === 'cancelled';
  const pendingKeys = new Set(state.pending.map(({ commandKey }) => commandKey));
  const cancellationStatus = state.status === 'cancelling' || state.status === 'cancelled';
  const terminalPayload =
    (state.status === 'succeeded' && state.result !== null && state.fault === null) ||
    (state.status === 'failed' && state.result === null && state.fault !== null) ||
    (state.status === 'cancelled' && state.result === null && state.fault === null) ||
    (!terminal && state.result === null && state.fault === null);
  return (
    cancellationStatus === (state.runCancellation !== null) &&
    terminalPayload &&
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
    PIPELINE_LIMITS.machine.liveOperations,
    machineObjectLimit,
    PIPELINE_LIMITS.machine.serializedStateJsonValues,
  );
  return owned.ok &&
    stateValidator.Check(owned.value) &&
    hasCanonicalStateArrays(owned.value) &&
    hasConsistentCancellationOwners(owned.value) &&
    hasConsistentStateStatus(owned.value) &&
    stateFitsMachineLimits(owned.value)
    ? owned.value
    : null;
};
