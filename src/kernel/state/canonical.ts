import { compareUnicodeCodePoints } from '../../foundation/index.js';
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
