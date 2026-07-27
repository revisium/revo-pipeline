import type { DecodeFaultCode } from './decode-fault-code.js';

export interface DecodeFault {
  readonly code: DecodeFaultCode;
  readonly path: string;
  readonly message: string;
}
