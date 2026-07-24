import type { HumanGateRoute } from './human-gate-route.js';
import type { NodeKey } from './node-key.js';

export type HumanGateNode = {
  readonly kind: 'humanGate';
  readonly key: NodeKey;
  readonly subject: string;
  readonly resolutions: readonly HumanGateRoute[];
};
