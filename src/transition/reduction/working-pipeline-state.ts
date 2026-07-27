import type {
  PipelineCandidateVerdictRecord,
  PipelineEffect,
  PipelineGateResolutionRecord,
  PipelineSnapshotNode,
  PipelineTerminal,
  PipelineValueRecord,
  PipelineSnapshot,
} from '../../spec/index.js';

export interface WorkingPipelineState {
  readonly baseline: PipelineSnapshot;
  readonly occurrenceKey: string;
  phase: 'uninitialized' | 'active' | 'terminal';
  readonly values: PipelineValueRecord[];
  readonly nodes: PipelineSnapshotNode[];
  readonly candidateVerdicts: PipelineCandidateVerdictRecord[];
  readonly gateResolutions: PipelineGateResolutionRecord[];
  terminal: PipelineTerminal | null;
  readonly effects: PipelineEffect[];
  applications: number;
}
