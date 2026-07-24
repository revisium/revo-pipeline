import type { PipelineDefinition } from '../spec/index.js';

export const definePipeline = <const T extends PipelineDefinition>(definition: T): T => definition;
