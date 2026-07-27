import type { PipelineForkRelation } from './pipeline-fork-relation.js';
import type { PipelineNodeOccurrence } from './pipeline-node-occurrence.js';

export type PipelineRetirement = {
  readonly occurrence: PipelineNodeOccurrence;
  readonly fork: PipelineForkRelation;
};
