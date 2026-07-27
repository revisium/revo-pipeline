import type { GraphKernel } from '../../graph/index.js';
import type { CompiledPipeline } from '../../spec/index.js';
import type { CompiledInspectionFault } from './compiled-inspection-fault.js';

export type CompiledInspection =
  | {
      readonly ok: true;
      readonly snapshot: CompiledPipeline;
      readonly kernel: GraphKernel;
      readonly topologicalOffsets: readonly number[];
    }
  | { readonly ok: false; readonly faults: readonly CompiledInspectionFault[] };
