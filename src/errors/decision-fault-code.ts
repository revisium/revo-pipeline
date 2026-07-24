import type { DECISION_FAULT_PHASES } from '../policy/index.js';

export type DecisionFaultCode = (typeof DECISION_FAULT_PHASES)[number]['codes'][number];
