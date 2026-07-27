import type { DecisionContext } from '../context/decision-context.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const canonicalizeWorkingState = (
  state: WorkingPipelineState,
  context: DecisionContext,
): void => {
  const factPosition = new Map(
    context.compiled.snapshot.facts.map((fact, index) => [fact.key, index]),
  );
  state.values.sort(
    (left, right) =>
      (factPosition.get(left.fact.key) ?? 999) - (factPosition.get(right.fact.key) ?? 999),
  );
  state.nodes.sort(
    (left, right) =>
      (context.topologicalPosition.get(left.occurrence.nodeKey) ?? 999) -
      (context.topologicalPosition.get(right.occurrence.nodeKey) ?? 999),
  );
  state.candidateVerdicts.sort(
    (left, right) =>
      (context.topologicalPosition.get(left.occurrence.nodeKey) ?? 999) -
        (context.topologicalPosition.get(right.occurrence.nodeKey) ?? 999) ||
      candidatePosition(context, left.occurrence.nodeKey, left.candidate) -
        candidatePosition(context, right.occurrence.nodeKey, right.candidate),
  );
  state.gateResolutions.sort(
    (left, right) =>
      (context.topologicalPosition.get(left.occurrence.nodeKey) ?? 999) -
      (context.topologicalPosition.get(right.occurrence.nodeKey) ?? 999),
  );
};

const candidatePosition = (
  context: DecisionContext,
  nodeKey: string,
  candidate: string,
): number => {
  const node = context.nodeByKey.get(nodeKey);
  return node?.kind === 'consensus' ? node.candidates.indexOf(candidate) : 999;
};
