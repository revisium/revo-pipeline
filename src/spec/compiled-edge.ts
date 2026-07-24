import type { BranchName } from './branch-name.js';
import type { CompiledEdgeRole } from './compiled-edge-role.js';
import type { NodeKey } from './node-key.js';

export type CompiledEdge = {
  readonly from: NodeKey;
  readonly outcome: string;
  readonly to: NodeKey;
  readonly role: CompiledEdgeRole;
  readonly fork: NodeKey | null;
  readonly branch: BranchName | null;
};
