import type { BranchName } from './branch-name.js';
import type { BranchPredicate } from './branch-predicate.js';
import type { NodeKey } from './node-key.js';

export type BranchCase = {
  readonly name: BranchName;
  readonly when: BranchPredicate;
  readonly to: NodeKey;
};
