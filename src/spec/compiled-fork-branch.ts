import type { ForkBranch } from './fork-branch.js';
import type { NodeKey } from './node-key.js';

export type CompiledForkBranch = ForkBranch & { readonly members: readonly NodeKey[] };
