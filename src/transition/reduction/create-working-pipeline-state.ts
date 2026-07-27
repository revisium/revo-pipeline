import type { SnapshotInspection } from '../snapshot/snapshot-inspection.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const createWorkingPipelineState = (
  inspection: SnapshotInspection,
): WorkingPipelineState => ({
  baseline: inspection.snapshot,
  occurrenceKey: inspection.snapshot.occurrenceKey,
  phase: inspection.snapshot.phase,
  values: [...inspection.snapshot.values],
  nodes: [...inspection.snapshot.nodes],
  candidateVerdicts: [...inspection.snapshot.candidateVerdicts],
  gateResolutions: [...inspection.snapshot.gateResolutions],
  terminal: inspection.snapshot.terminal,
  effects: [],
  applications: 0,
});
