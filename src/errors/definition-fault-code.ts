import type { DEFINITION_FAULT_PHASES } from '../policy/index.js';

export type DefinitionFaultCode = (typeof DEFINITION_FAULT_PHASES)[number]['codes'][number];
