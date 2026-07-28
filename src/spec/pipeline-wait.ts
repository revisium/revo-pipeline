import type { PipelineNodeOccurrence } from './pipeline-node-occurrence.js';
import type { WaitReason } from './wait-reason.js';

export type PipelineWait = {
  readonly occurrence: PipelineNodeOccurrence;
  readonly reason: WaitReason;
};
