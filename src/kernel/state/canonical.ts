import { compareUnicodeCodePoints } from '../../foundation/index.js';
import type { MachineFrame } from '../contracts/frames.js';
import type { PendingOperation, ResolvedOperation } from '../contracts/operations.js';
import type { PipelineState } from '../contracts/state.js';

const byKey =
  <Value>(key: (value: Value) => string) =>
  (left: Value, right: Value) =>
    compareUnicodeCodePoints(key(left), key(right));

const freezeSorted = <Value>(values: readonly Value[], key: (value: Value) => string) =>
  Object.freeze([...values].sort(byKey(key)));

export const ownPipelineState = (state: PipelineState): PipelineState =>
  Object.freeze({
    ...state,
    frames: freezeSorted(state.frames, ({ key }) => key),
    pending: freezeSorted(state.pending, ({ commandKey }) => commandKey),
    resolved: freezeSorted(state.resolved, ({ commandKey }) => commandKey),
    regionCancellations: freezeSorted(state.regionCancellations, ({ frameKey }) => frameKey),
  });

export const replaceFrame = (state: PipelineState, frame: MachineFrame): PipelineState =>
  ownPipelineState({
    ...state,
    frames: [...state.frames.filter(({ key }) => key !== frame.key), frame],
  });

export const replaceFrames = (
  state: PipelineState,
  removeKeys: ReadonlySet<string>,
  additions: readonly MachineFrame[],
): PipelineState =>
  ownPipelineState({
    ...state,
    frames: [...state.frames.filter(({ key }) => !removeKeys.has(key)), ...additions],
  });

export const replacePendingWithReceipt = (
  state: PipelineState,
  pending: PendingOperation,
  receipt: ResolvedOperation,
): PipelineState =>
  ownPipelineState({
    ...state,
    pending: state.pending.filter(({ commandKey }) => commandKey !== pending.commandKey),
    resolved: [
      ...state.resolved.filter(({ commandKey }) => commandKey !== receipt.commandKey),
      receipt,
    ],
  });

export const pruneResolvedReceipts = (state: PipelineState): PipelineState => {
  const liveFrameKeys = new Set(state.frames.map(({ key }) => key));
  const acknowledged = new Set([
    ...(state.runCancellation?.awaiting ?? []),
    ...state.regionCancellations.flatMap(({ awaiting }) => awaiting),
  ]);
  const resolved = state.resolved.filter(
    ({ commandKey, ref }) => liveFrameKeys.has(ref.frameKey) || acknowledged.has(commandKey),
  );
  return resolved.length === state.resolved.length
    ? state
    : ownPipelineState({ ...state, resolved });
};
