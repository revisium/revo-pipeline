import type { BranchCase } from './branch-case.js';
import type { BranchDefault } from './branch-default.js';
import type { FactKey } from './fact-key.js';
import type { NodeKey } from './node-key.js';

export type BranchNode = {
  readonly kind: 'branch';
  readonly key: NodeKey;
  readonly fact: FactKey;
  readonly cases: readonly BranchCase[];
  readonly default: BranchDefault | null;
};
