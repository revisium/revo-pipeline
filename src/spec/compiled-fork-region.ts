import type { CompiledForkBranch } from './compiled-fork-branch.js';
import type { NodeKey } from './node-key.js';

export type CompiledForkRegion = {
  readonly fork: NodeKey;
  readonly join: NodeKey;
  readonly branches: readonly CompiledForkBranch[];
};
