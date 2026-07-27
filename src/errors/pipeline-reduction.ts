import type {
  PipelineCommandApplication,
  PipelineEffectBatch,
  PipelineSnapshot,
  PipelineTerminal,
  PipelineWait,
} from '../spec/index.js';
import type { PipelineReductionFault } from './pipeline-reduction-fault.js';

type PipelineReductionSuccessBase = {
  readonly ok: true;
  readonly application: PipelineCommandApplication;
  readonly snapshot: PipelineSnapshot;
  readonly batch: PipelineEffectBatch;
};

export type PipelineReduction =
  | (PipelineReductionSuccessBase & {
      readonly status: 'waiting';
      readonly wait: PipelineWait;
      readonly terminal: null;
    })
  | (PipelineReductionSuccessBase & {
      readonly status: 'terminal';
      readonly wait: null;
      readonly terminal: PipelineTerminal;
    })
  | { readonly ok: false; readonly faults: readonly PipelineReductionFault[] };
