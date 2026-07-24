import type { NodeKey } from './node-key.js';

export type SelectDecision = {
  readonly kind: 'select';
  readonly nodeKey: NodeKey;
  readonly outcome: string;
  readonly activate: readonly NodeKey[];
};
