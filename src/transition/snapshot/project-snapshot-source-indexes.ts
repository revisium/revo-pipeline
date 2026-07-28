import type { SnapshotInspection } from './snapshot-inspection.js';

export const projectSnapshotSourceIndexes = (
  inspection: SnapshotInspection,
): Readonly<
  Record<'values' | 'nodes' | 'candidateVerdicts' | 'gateResolutions', readonly number[]>
> => {
  const retired = new Set(
    inspection.snapshot.nodes.flatMap((node) =>
      node.state === 'retired' ? [node.occurrence.nodeKey] : [],
    ),
  );
  return {
    values: inspection.sourceIndexes.values,
    nodes: inspection.snapshot.nodes.flatMap((node, index) =>
      node.state === 'retired' ? [] : [inspection.sourceIndexes.nodes[index] ?? -1],
    ),
    candidateVerdicts: inspection.snapshot.candidateVerdicts.flatMap((record, index) =>
      retired.has(record.occurrence.nodeKey)
        ? []
        : [inspection.sourceIndexes.candidateVerdicts[index] ?? -1],
    ),
    gateResolutions: inspection.snapshot.gateResolutions.flatMap((record, index) =>
      retired.has(record.occurrence.nodeKey)
        ? []
        : [inspection.sourceIndexes.gateResolutions[index] ?? -1],
    ),
  };
};
