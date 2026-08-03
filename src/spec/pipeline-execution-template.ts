import type { CompiledPipeline } from './compiled-pipeline.js';
import type { ExecutorRequirement } from './executor-requirement.js';
import type { TerminalBindingTemplate } from './terminal-binding-template.js';

export type PipelineExecutionTemplate = {
  readonly pipeline: CompiledPipeline;
  readonly executorRequirements: readonly ExecutorRequirement[];
  readonly terminalBindings: readonly TerminalBindingTemplate[];
};
