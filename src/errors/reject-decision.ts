import type { DecisionFault } from './decision-fault.js';

export type RejectDecision = {
  readonly kind: 'reject';
  readonly faults: readonly DecisionFault[];
};
