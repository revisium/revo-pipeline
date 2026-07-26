import type { GraphKernel } from '../graph/index.js';
import type { CompiledPipeline } from '../spec/index.js';

export type ValidatedCompiledPipeline =
  | {
      readonly ok: true;
      readonly pipeline: CompiledPipeline;
      readonly kernel: GraphKernel;
      readonly topologicalOffsets: readonly number[];
    }
  | { readonly ok: false };
