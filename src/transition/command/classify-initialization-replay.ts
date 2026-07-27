import type { PipelineCommand } from '../../spec/index.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';
import type { SnapshotInspection } from '../snapshot/snapshot-inspection.js';

export const classifyInitializationReplay = (
  command: Extract<PipelineCommand, { readonly kind: 'init' }>,
  snapshot: SnapshotInspection['snapshot'],
  faults: ReductionDiagnosticCollector,
): 'new' | 'unchanged' | 'invalid' => {
  if (snapshot.phase === 'uninitialized') {
    return 'new';
  }
  const existing = snapshot.values
    .filter((record) => record.source.kind === 'init')
    .map((record) => record.fact);
  if (JSON.stringify(existing) === JSON.stringify(command.values)) {
    return 'unchanged';
  }
  faults.add('COMMAND_CONFLICT', '/command', 'Initialization conflicts with recorded content.');
  return 'invalid';
};
