import type { NodeKey } from './node-key.js';
import type { WaitReason } from './wait-reason.js';

export type WaitDecision = {
  readonly kind: 'wait';
  readonly nodeKey: NodeKey;
  readonly reason: WaitReason;
};
