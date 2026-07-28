import type { PipelineNodeOccurrence } from './pipeline-node-occurrence.js';

export type PipelineTerminal = {
  readonly occurrence: PipelineNodeOccurrence;
  readonly outcome: string;
};
