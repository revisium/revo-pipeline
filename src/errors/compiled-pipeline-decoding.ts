import type { CompiledPipeline } from '../spec/index.js';
import type { DecodeFault } from './decode-fault.js';

export type CompiledPipelineDecoding =
  | { readonly ok: true; readonly pipeline: CompiledPipeline }
  | { readonly ok: false; readonly faults: readonly DecodeFault[] };
