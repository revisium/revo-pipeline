import type { CompiledPipeline, PipelineExecutionTemplate } from '../spec/index.js';
import type { DefinitionFault } from './definition-fault.js';

export type PipelineCompilation =
  | {
      readonly ok: true;
      readonly pipeline: CompiledPipeline;
      readonly template: PipelineExecutionTemplate;
    }
  | { readonly ok: false; readonly faults: readonly DefinitionFault[] };
