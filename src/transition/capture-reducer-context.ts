import type { PipelineReductionFaultCode } from '../errors/index.js';
import type { ReductionDiagnosticCollector } from './reduction/reduction-diagnostic-collector.js';

export interface CaptureReducerContext {
  readonly root: '/snapshot' | '/command';
  readonly code: PipelineReductionFaultCode;
  readonly faults: ReductionDiagnosticCollector;
  visits: number;
}
