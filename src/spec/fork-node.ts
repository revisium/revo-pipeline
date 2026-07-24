import type { ForkBranch } from './fork-branch.js';
import type { NodeKey } from './node-key.js';

export type ForkNode = {
  readonly kind: 'fork';
  readonly key: NodeKey;
  readonly join: NodeKey;
  readonly branches: readonly ForkBranch[];
};
