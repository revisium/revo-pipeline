import type { CandidateVerdict } from './candidate-verdict.js';
import type { GateResolution } from './gate-resolution.js';
import type { NodeFact } from './node-fact.js';
import type { PipelineValueFact } from './pipeline-value-fact.js';

export type PipelineFacts = {
  readonly values: readonly PipelineValueFact[];
  readonly nodes: readonly NodeFact[];
  readonly candidateVerdicts: readonly CandidateVerdict[];
  readonly gateResolutions: readonly GateResolution[];
};
