import type { NodeKey } from './node-key.js';

export type TerminalDecision = {
  readonly kind: 'terminal';
  readonly nodeKey: NodeKey;
  readonly outcome: string;
};
