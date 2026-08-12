import type { JsonPointer } from '../../foundation/index.js';
import { MACHINE_FAULTS, type MachineFault, type MachineFaultCode } from './faults.js';

const dynamicPathCodes: ReadonlySet<MachineFaultCode> = new Set([
  'DATA_POINTER_MISSING',
  'DATA_SCHEMA_MISMATCH',
]);

export const createMachineFault = (code: MachineFaultCode, path?: JsonPointer): MachineFault => {
  const definition = MACHINE_FAULTS[code];
  return Object.freeze({
    family: definition.family,
    code,
    path: dynamicPathCodes.has(code) && path !== undefined ? path : definition.path,
    message: definition.message,
  });
};
