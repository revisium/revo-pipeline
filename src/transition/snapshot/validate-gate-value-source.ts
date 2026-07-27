import type { PipelineSnapshotNode } from '../../spec/index.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';
import type { SnapshotInspection } from './snapshot-inspection.js';

export const validateGateValueSource = (
  sourceNode: { readonly node: PipelineSnapshotNode; readonly index: number } | undefined,
  nodeKey: string,
  path: string,
  snapshot: SnapshotInspection['snapshot'],
  faults: ReductionDiagnosticCollector,
): void => {
  if (!sourceNode) {
    faults.add('SNAPSHOT_PREMATURE', `${path}/source`, 'Snapshot value source is not completed.');
    return;
  }
  const resolution = snapshot.gateResolutions.find((item) => item.occurrence.nodeKey === nodeKey);
  if (!resolution) {
    faults.add('SNAPSHOT_RESOLUTION', `${path}/source`, 'Gate source resolution is missing.');
    return;
  }
  if (
    sourceNode.node.state === 'retired' &&
    (snapshot.phase !== 'terminal' ||
      sourceNode.node.terminal.occurrence.nodeKey !== snapshot.terminal.occurrence.nodeKey ||
      sourceNode.node.terminal.outcome !== snapshot.terminal.outcome)
  ) {
    faults.add(
      'SNAPSHOT_PHASE',
      `/snapshot/nodes/${sourceNode.index}`,
      'Retired gate source is invalid.',
    );
    return;
  }
  if (sourceNode.node.state === 'terminal' && sourceNode.node.outcome !== resolution.resolution) {
    faults.add(
      'SNAPSHOT_OUTCOME',
      `/snapshot/nodes/${sourceNode.index}/outcome`,
      'Gate source outcome is invalid.',
    );
  }
};
