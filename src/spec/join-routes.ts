import type { JoinOutcome } from './join-outcome.js';
import type { NodeKey } from './node-key.js';

export type JoinRoutes = Readonly<Record<JoinOutcome, NodeKey>>;
