import type { PipelineSnapshot } from '../../spec/index.js';

export interface SnapshotInspection {
  readonly snapshot: PipelineSnapshot;
  readonly sourceIndexes: {
    readonly values: readonly number[];
    readonly nodes: readonly number[];
    readonly candidateVerdicts: readonly number[];
    readonly gateResolutions: readonly number[];
  };
}
