import type { DecisionFaultCode } from './decision-fault-code.js';

export type DecisionFault = {
  readonly code: DecisionFaultCode;
  readonly path: string;
  readonly message: string;
};
