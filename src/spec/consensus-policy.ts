import type { QuorumConsensusPolicy } from './quorum-consensus-policy.js';
import type { ThresholdConsensusPolicy } from './threshold-consensus-policy.js';
import type { UnanimousConsensusPolicy } from './unanimous-consensus-policy.js';

export type ConsensusPolicy =
  | UnanimousConsensusPolicy
  | QuorumConsensusPolicy
  | ThresholdConsensusPolicy;
