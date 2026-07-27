import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import { deriveForkRelation } from './derive-fork-relation.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const applyTerminalDecision = (
  decision: Extract<PipelineDecision, { readonly kind: 'terminal' }>,
  state: WorkingPipelineState,
  context: DecisionContext,
): void => {
  const index = state.nodes.findIndex((node) => node.occurrence.nodeKey === decision.nodeKey);
  const node = state.nodes[index];
  if (node) {
    state.nodes[index] = {
      occurrence: node.occurrence,
      state: 'terminal',
      outcome: decision.outcome,
    };
  }
  const terminal = {
    occurrence: { occurrenceKey: state.occurrenceKey, nodeKey: decision.nodeKey },
    outcome: decision.outcome,
  };
  const residual = state.nodes
    .filter((item) => item.state === 'enabled' && item.occurrence.nodeKey !== decision.nodeKey)
    .toSorted(
      (left, right) =>
        (context.topologicalPosition.get(left.occurrence.nodeKey) ?? 999) -
        (context.topologicalPosition.get(right.occurrence.nodeKey) ?? 999),
    );
  const retirements = residual.map((item) => ({
    occurrence: item.occurrence,
    fork: deriveForkRelation(item.occurrence.nodeKey, context),
  }));
  const retiredKeys = new Set(residual.map((item) => item.occurrence.nodeKey));
  state.nodes.splice(
    0,
    state.nodes.length,
    ...state.nodes.map((item) =>
      retiredKeys.has(item.occurrence.nodeKey)
        ? { occurrence: item.occurrence, state: 'retired' as const, terminal }
        : item,
    ),
  );
  state.phase = 'terminal';
  state.terminal = terminal;
  state.effects.push({ kind: 'terminatePipeline', terminal, retirements });
};
