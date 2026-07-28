import type { CandidateKey } from './candidate-key.js';
import type { PipelineNodeOccurrence } from './pipeline-node-occurrence.js';

export type PipelineCandidateVerdictRecord = {
  readonly occurrence: PipelineNodeOccurrence;
  readonly candidate: CandidateKey;
  readonly verdict: 'approve' | 'reject' | 'abstain';
};
