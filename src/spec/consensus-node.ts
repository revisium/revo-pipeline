import type { CandidateKey } from './candidate-key.js';
import type { ConsensusPolicy } from './consensus-policy.js';
import type { ConsensusRoutes } from './consensus-routes.js';
import type { NodeKey } from './node-key.js';

export type ConsensusNode = {
  readonly kind: 'consensus';
  readonly key: NodeKey;
  readonly candidates: readonly CandidateKey[];
  readonly policy: ConsensusPolicy;
  readonly outcomes: ConsensusRoutes;
};
