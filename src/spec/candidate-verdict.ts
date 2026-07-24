import type { CandidateKey } from './candidate-key.js';
import type { NodeKey } from './node-key.js';

export type CandidateVerdict = {
  readonly nodeKey: NodeKey;
  readonly candidate: CandidateKey;
  readonly verdict: 'approve' | 'reject' | 'abstain';
};
