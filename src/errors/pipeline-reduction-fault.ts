import type { PipelineReductionFaultCode } from './pipeline-reduction-fault-code.js';

export type PipelineReductionFault = {
  readonly code: PipelineReductionFaultCode;
  readonly path: string;
  readonly message: string;
};
