import type { PipelineSnapshotNode } from '../../spec/index.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';

export const validateTaskValueSource = (
  sourceNode: { readonly node: PipelineSnapshotNode; readonly index: number } | undefined,
  path: string,
  faults: ReductionDiagnosticCollector,
): void => {
  if (!sourceNode) {
    faults.add('SNAPSHOT_PREMATURE', `${path}/source`, 'Snapshot value source is not completed.');
    return;
  }
  if (sourceNode.node.state !== 'terminal') {
    faults.add('SNAPSHOT_PREMATURE', `${path}/source`, 'Snapshot task source is not completed.');
    return;
  }
  if (sourceNode.node.outcome !== 'completed') {
    faults.add(
      'SNAPSHOT_OUTCOME',
      `/snapshot/nodes/${sourceNode.index}/outcome`,
      'Task source outcome is invalid.',
    );
  }
};
