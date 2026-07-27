import type { GraphKernel } from '../../graph/index.js';
import type { CompiledPipeline } from '../../spec/index.js';

export type HostileCompiledValidation =
  | {
      readonly ok: true;
      readonly snapshot: CompiledPipeline;
      readonly kernel: GraphKernel;
      readonly topologicalOffsets: readonly number[];
    }
  | { readonly ok: false };
