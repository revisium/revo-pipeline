import type { BranchName } from './branch-name.js';
import type { NodeKey } from './node-key.js';

export type ForkBranch = {
  readonly name: BranchName;
  readonly entry: NodeKey;
  readonly exit: NodeKey;
};
