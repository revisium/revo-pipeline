import type { PipelineFacts } from '../../spec/index.js';
import type { SnapshotInspection } from './snapshot-inspection.js';

export const projectSnapshotFacts = (inspection: SnapshotInspection): PipelineFacts => {
  const snapshot = inspection.snapshot;
  const retired = new Set(
    snapshot.nodes.flatMap((node) => (node.state === 'retired' ? [node.occurrence.nodeKey] : [])),
  );
  const nodes: Array<PipelineFacts['nodes'][number]> = [];
  snapshot.nodes.forEach((node) => {
    if (node.state === 'terminal') {
      nodes.push({ key: node.occurrence.nodeKey, state: 'terminal', outcome: node.outcome });
    } else if (node.state === 'enabled') {
      nodes.push({ key: node.occurrence.nodeKey, state: 'enabled' });
    }
  });
  const candidateVerdicts: PipelineFacts['candidateVerdicts'] = snapshot.candidateVerdicts.flatMap(
    (record) =>
      retired.has(record.occurrence.nodeKey)
        ? []
        : [
            {
              nodeKey: record.occurrence.nodeKey,
              candidate: record.candidate,
              verdict: record.verdict,
            },
          ],
  );
  const gateResolutions: PipelineFacts['gateResolutions'] = snapshot.gateResolutions.flatMap(
    (record) =>
      retired.has(record.occurrence.nodeKey)
        ? []
        : [
            {
              nodeKey: record.occurrence.nodeKey,
              resolution: record.resolution,
            },
          ],
  );
  return {
    values: snapshot.values.map((record) => record.fact),
    nodes,
    candidateVerdicts,
    gateResolutions,
  };
};
