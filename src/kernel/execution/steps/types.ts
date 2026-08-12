import type { Digest } from '../../../foundation/index.js';
import type { PipelineState } from '../../contracts/state.js';
import type { BaseSaturationResult } from '../base-types.js';

export type ContinueStep = {
  readonly kind: 'continue';
  readonly state: PipelineState;
  readonly nextFrameKey: Digest;
  readonly nextModuleAncestry: readonly [string, ...string[]];
};

export type BaseStepResult = ContinueStep | BaseSaturationResult;

export const continueAt = (
  state: PipelineState,
  nextFrameKey: Digest,
  nextModuleAncestry: readonly [string, ...string[]],
): ContinueStep => Object.freeze({ kind: 'continue', state, nextFrameKey, nextModuleAncestry });
