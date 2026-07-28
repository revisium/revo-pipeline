import type { PipelineCandidateVerdictRecord } from './pipeline-candidate-verdict-record.js';
import type { PipelineGateResolutionRecord } from './pipeline-gate-resolution-record.js';
import type { PipelineOccurrenceKey } from './pipeline-occurrence-key.js';
import type { PipelineSnapshotNode } from './pipeline-snapshot-node.js';
import type { PipelineTerminal } from './pipeline-terminal.js';
import type { PipelineValueRecord } from './pipeline-value-record.js';

export type PipelineSnapshot =
  | {
      readonly schemaVersion: 1;
      readonly occurrenceKey: PipelineOccurrenceKey;
      readonly phase: 'uninitialized';
      readonly values: readonly [];
      readonly nodes: readonly [];
      readonly candidateVerdicts: readonly [];
      readonly gateResolutions: readonly [];
      readonly terminal: null;
    }
  | {
      readonly schemaVersion: 1;
      readonly occurrenceKey: PipelineOccurrenceKey;
      readonly phase: 'active';
      readonly values: readonly PipelineValueRecord[];
      readonly nodes: readonly Extract<
        PipelineSnapshotNode,
        { readonly state: 'enabled' | 'terminal' }
      >[];
      readonly candidateVerdicts: readonly PipelineCandidateVerdictRecord[];
      readonly gateResolutions: readonly PipelineGateResolutionRecord[];
      readonly terminal: null;
    }
  | {
      readonly schemaVersion: 1;
      readonly occurrenceKey: PipelineOccurrenceKey;
      readonly phase: 'terminal';
      readonly values: readonly PipelineValueRecord[];
      readonly nodes: readonly PipelineSnapshotNode[];
      readonly candidateVerdicts: readonly PipelineCandidateVerdictRecord[];
      readonly gateResolutions: readonly PipelineGateResolutionRecord[];
      readonly terminal: PipelineTerminal;
    };
