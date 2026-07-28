import type { PipelineNodeOccurrence } from './pipeline-node-occurrence.js';
import type { ResolutionName } from './resolution-name.js';

export type PipelineGateResolutionRecord = {
  readonly occurrence: PipelineNodeOccurrence;
  readonly resolution: ResolutionName;
};
