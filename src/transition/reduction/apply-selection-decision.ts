import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import { applyActivationDecision } from './apply-activation-decision.js';
import type { ReductionDiagnosticCollector } from './reduction-diagnostic-collector.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const applySelectionDecision = (
  decision: Extract<PipelineDecision, { readonly kind: 'select' }>,
  state: WorkingPipelineState,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
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
  state.effects.push({
    kind: 'completeSelector',
    occurrence: { occurrenceKey: state.occurrenceKey, nodeKey: decision.nodeKey },
    outcome: decision.outcome,
  });
  applyActivationDecision(
    {
      kind: 'activate',
      nodeKeys: decision.activate,
      cause: { kind: 'node', nodeKey: decision.nodeKey, outcome: decision.outcome },
    },
    state,
    context,
    faults,
  );
};
