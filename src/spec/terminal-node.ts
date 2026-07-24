import type { NodeKey } from './node-key.js';

export type TerminalNode = {
  readonly kind: 'terminal';
  readonly key: NodeKey;
  readonly outcome: string;
};
