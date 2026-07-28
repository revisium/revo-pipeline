import type { PipelineDecision } from '../../errors/index.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';
import type { SnapshotInspection } from './snapshot-inspection.js';

export const validateSnapshotPhase = (
  snapshot: SnapshotInspection['snapshot'],
  decision: PipelineDecision,
  faults: ReductionDiagnosticCollector,
): boolean => {
  if (snapshot.phase === 'uninitialized') {
    const empty =
      snapshot.values.length === 0 &&
      snapshot.nodes.length === 0 &&
      snapshot.candidateVerdicts.length === 0 &&
      snapshot.gateResolutions.length === 0 &&
      snapshot.terminal === null;
    if (!empty) {
      faults.add('SNAPSHOT_PHASE', '/snapshot/phase', 'Uninitialized snapshot is not empty.');
    }
    return empty;
  }
  if (snapshot.phase === 'active') {
    if (decision.kind !== 'wait') {
      faults.add('SNAPSHOT_UNSETTLED', '/snapshot', 'Active snapshot is not settled.');
      return false;
    }
    return true;
  }
  if (snapshot.nodes.some((node) => node.state === 'enabled')) {
    faults.add('SNAPSHOT_PHASE', '/snapshot/nodes', 'Terminal snapshot contains an enabled node.');
    return false;
  }
  const inconsistentRetirement = snapshot.nodes.some(
    (node) =>
      node.state === 'retired' &&
      (node.terminal.occurrence.occurrenceKey !== snapshot.terminal.occurrence.occurrenceKey ||
        node.terminal.occurrence.nodeKey !== snapshot.terminal.occurrence.nodeKey ||
        node.terminal.outcome !== snapshot.terminal.outcome),
  );
  if (inconsistentRetirement) {
    faults.add(
      'SNAPSHOT_PHASE',
      '/snapshot/nodes',
      'Retired node terminal summary is inconsistent.',
    );
    return false;
  }
  if (
    decision.kind !== 'terminal' ||
    snapshot.terminal.outcome !== decision.outcome ||
    snapshot.terminal.occurrence.nodeKey !== decision.nodeKey
  ) {
    faults.add(
      'SNAPSHOT_PHASE',
      '/snapshot/terminal',
      'Terminal snapshot summary is inconsistent.',
    );
    return false;
  }
  return true;
};
