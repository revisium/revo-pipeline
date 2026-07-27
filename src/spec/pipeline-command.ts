import type { CandidateKey } from './candidate-key.js';
import type { PipelineNodeOccurrence } from './pipeline-node-occurrence.js';
import type { PipelineValueFact } from './pipeline-value-fact.js';
import type { ResolutionName } from './resolution-name.js';
import type { TaskOutcome } from './task-outcome.js';

export type PipelineCommand =
  | {
      readonly schemaVersion: 1;
      readonly kind: 'init';
      readonly values: readonly PipelineValueFact[];
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: 'taskOutcome';
      readonly occurrence: PipelineNodeOccurrence;
      readonly outcome: TaskOutcome;
      readonly values: readonly PipelineValueFact[];
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: 'consensusVerdict';
      readonly occurrence: PipelineNodeOccurrence;
      readonly candidate: CandidateKey;
      readonly verdict: 'approve' | 'reject' | 'abstain';
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: 'humanGateResolution';
      readonly occurrence: PipelineNodeOccurrence;
      readonly resolution: ResolutionName;
      readonly values: readonly PipelineValueFact[];
    };
