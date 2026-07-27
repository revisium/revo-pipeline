import type { BranchName } from './branch-name.js';
import type { NodeKey } from './node-key.js';

export type PipelineForkRelation =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'branch';
      readonly forkNodeKey: NodeKey;
      readonly joinNodeKey: NodeKey;
      readonly branch: BranchName;
      readonly role: 'entry' | 'member' | 'exit' | 'entryExit';
    }
  | {
      readonly kind: 'join';
      readonly forkNodeKey: NodeKey;
      readonly joinNodeKey: NodeKey;
      readonly role: 'join';
    };
