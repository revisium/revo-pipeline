import type { PipelineSnapshot } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { SnapshotInspection } from './snapshot-inspection.js';

export const canonicalizePipelineSnapshot = (
  inspection: SnapshotInspection,
  context: DecisionContext,
): SnapshotInspection => {
  const snapshot = inspection.snapshot;
  const factPosition = new Map(
    context.compiled.snapshot.facts.map((fact, index) => [fact.key, index]),
  );
  const nodePosition = context.topologicalPosition;
  const values = snapshot.values.toSorted(
    (left, right) =>
      (factPosition.get(left.fact.key) ?? 999) - (factPosition.get(right.fact.key) ?? 999),
  );
  const nodes = snapshot.nodes.toSorted(
    (left, right) =>
      (nodePosition.get(left.occurrence.nodeKey) ?? 999) -
      (nodePosition.get(right.occurrence.nodeKey) ?? 999),
  );
  const candidatePosition = (nodeKey: string, candidate: string): number => {
    const node = context.nodeByKey.get(nodeKey);
    return node?.kind === 'consensus' ? node.candidates.indexOf(candidate) : 999;
  };
  const candidateVerdicts = snapshot.candidateVerdicts.toSorted(
    (left, right) =>
      (nodePosition.get(left.occurrence.nodeKey) ?? 999) -
        (nodePosition.get(right.occurrence.nodeKey) ?? 999) ||
      candidatePosition(left.occurrence.nodeKey, left.candidate) -
        candidatePosition(right.occurrence.nodeKey, right.candidate),
  );
  const gateResolutions = snapshot.gateResolutions.toSorted(
    (left, right) =>
      (nodePosition.get(left.occurrence.nodeKey) ?? 999) -
      (nodePosition.get(right.occurrence.nodeKey) ?? 999),
  );
  let canonical: PipelineSnapshot;
  if (snapshot.phase === 'terminal') {
    canonical = { ...snapshot, values, nodes, candidateVerdicts, gateResolutions };
  } else if (snapshot.phase === 'active') {
    const activeNodes = nodes.flatMap((node) => (node.state === 'retired' ? [] : [node]));
    canonical = { ...snapshot, values, nodes: activeNodes, candidateVerdicts, gateResolutions };
  } else {
    canonical = snapshot;
  }
  return {
    snapshot: canonical,
    sourceIndexes: {
      values: values.map(
        (record) => inspection.sourceIndexes.values[referenceIndex(snapshot.values, record)] ?? -1,
      ),
      nodes: nodes.map(
        (record) => inspection.sourceIndexes.nodes[referenceIndex(snapshot.nodes, record)] ?? -1,
      ),
      candidateVerdicts: candidateVerdicts.map(
        (record) =>
          inspection.sourceIndexes.candidateVerdicts[
            referenceIndex(snapshot.candidateVerdicts, record)
          ] ?? -1,
      ),
      gateResolutions: gateResolutions.map(
        (record) =>
          inspection.sourceIndexes.gateResolutions[
            referenceIndex(snapshot.gateResolutions, record)
          ] ?? -1,
      ),
    },
  };
};

const referenceIndex = <T>(values: readonly T[], value: T): number => values.lastIndexOf(value);
