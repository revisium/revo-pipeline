import type { NodeKey } from './node-key.js';

export type NodeFact =
  | { readonly key: NodeKey; readonly state: 'enabled' }
  | { readonly key: NodeKey; readonly state: 'terminal'; readonly outcome: string };
