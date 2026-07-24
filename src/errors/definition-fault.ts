import type { DefinitionFaultCode } from './definition-fault-code.js';

export type DefinitionFault = {
  readonly code: DefinitionFaultCode;
  readonly path: string;
  readonly message: string;
};
