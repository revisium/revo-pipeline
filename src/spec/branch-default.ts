import type { BranchName } from './branch-name.js';
import type { NodeKey } from './node-key.js';

export type BranchDefault = { readonly name: BranchName; readonly to: NodeKey };
