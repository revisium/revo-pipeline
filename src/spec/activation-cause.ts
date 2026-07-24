import type { NodeKey } from './node-key.js';

export type ActivationCause =
  | { readonly kind: 'entry' }
  | { readonly kind: 'node'; readonly nodeKey: NodeKey; readonly outcome: string };
