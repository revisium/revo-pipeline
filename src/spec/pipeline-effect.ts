import type { ActivationCause } from './activation-cause.js';
import type { CandidateKey } from './candidate-key.js';
import type { PipelineForkRelation } from './pipeline-fork-relation.js';
import type { PipelineNodeOccurrence } from './pipeline-node-occurrence.js';
import type { PipelineOccurrenceKey } from './pipeline-occurrence-key.js';
import type { PipelineRetirement } from './pipeline-retirement.js';
import type { PipelineTerminal } from './pipeline-terminal.js';
import type { PipelineValueFact } from './pipeline-value-fact.js';
import type { ResolutionName } from './resolution-name.js';
import type { TaskOutcome } from './task-outcome.js';

export type PipelineEffect =
  | {
      readonly kind: 'initialize';
      readonly occurrenceKey: PipelineOccurrenceKey;
      readonly values: readonly PipelineValueFact[];
    }
  | {
      readonly kind: 'completeTask';
      readonly occurrence: PipelineNodeOccurrence;
      readonly outcome: TaskOutcome;
      readonly values: readonly PipelineValueFact[];
    }
  | {
      readonly kind: 'recordConsensusVerdict';
      readonly occurrence: PipelineNodeOccurrence;
      readonly candidate: CandidateKey;
      readonly verdict: 'approve' | 'reject' | 'abstain';
    }
  | {
      readonly kind: 'resolveHumanGate';
      readonly occurrence: PipelineNodeOccurrence;
      readonly resolution: ResolutionName;
      readonly values: readonly PipelineValueFact[];
    }
  | {
      readonly kind: 'completeSelector';
      readonly occurrence: PipelineNodeOccurrence;
      readonly outcome: string;
    }
  | {
      readonly kind: 'activateNode';
      readonly occurrence: PipelineNodeOccurrence;
      readonly cause: ActivationCause;
      readonly fork: PipelineForkRelation;
    }
  | {
      readonly kind: 'terminatePipeline';
      readonly terminal: PipelineTerminal;
      readonly retirements: readonly PipelineRetirement[];
    };
