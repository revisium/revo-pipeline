import type { NodeKey } from './node-key.js';

export type TerminalBindingTemplate = {
  readonly nodeKey: NodeKey;
  readonly outcome: string;
};
