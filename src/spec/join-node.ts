import type { JoinPolicy } from './join-policy.js';
import type { JoinRoutes } from './join-routes.js';
import type { NodeKey } from './node-key.js';

export type JoinNode = {
  readonly kind: 'join';
  readonly key: NodeKey;
  readonly fork: NodeKey;
  readonly policy: JoinPolicy;
  readonly outcomes: JoinRoutes;
};
