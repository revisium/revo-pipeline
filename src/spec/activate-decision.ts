import type { ActivationCause } from './activation-cause.js';
import type { NodeKey } from './node-key.js';

export type ActivateDecision = {
  readonly kind: 'activate';
  readonly cause: ActivationCause;
  readonly nodeKeys: readonly NodeKey[];
};
