import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import { deriveForkRelation } from './derive-fork-relation.js';
import type { ReductionDiagnosticCollector } from './reduction-diagnostic-collector.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const applyActivationDecision = (
  decision: Extract<PipelineDecision, { readonly kind: 'activate' }>,
  state: WorkingPipelineState,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): void => {
  decision.nodeKeys
    .toSorted(
      (left, right) =>
        (context.topologicalPosition.get(left) ?? 999) -
        (context.topologicalPosition.get(right) ?? 999),
    )
    .forEach((nodeKey) => {
      if (state.nodes.some((node) => node.occurrence.nodeKey === nodeKey)) {
        faults.add('REDUCTION_INVARIANT', '/reduction', 'Activation target already exists.');
        return;
      }
      const occurrence = { occurrenceKey: state.occurrenceKey, nodeKey };
      state.nodes.push({ occurrence, state: 'enabled' });
      state.effects.push({
        kind: 'activateNode',
        occurrence,
        cause: decision.cause,
        fork: deriveForkRelation(nodeKey, context),
      });
    });
};
