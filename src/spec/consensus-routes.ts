import type { ConsensusOutcome } from './consensus-outcome.js';
import type { NodeKey } from './node-key.js';

export type ConsensusRoutes = Readonly<Record<ConsensusOutcome, NodeKey>>;
