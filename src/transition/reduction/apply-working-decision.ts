import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import { applyActivationDecision } from './apply-activation-decision.js';
import { applySelectionDecision } from './apply-selection-decision.js';
import { applyTerminalDecision } from './apply-terminal-decision.js';
import type { ReductionDiagnosticCollector } from './reduction-diagnostic-collector.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const applyWorkingDecision = (
  decision: Exclude<PipelineDecision, { readonly kind: 'reject' | 'noop' | 'wait' }>,
  state: WorkingPipelineState,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): boolean => {
  if (decision.kind === 'activate') {
    applyActivationDecision(decision, state, context, faults);
    return false;
  }
  if (decision.kind === 'select') {
    applySelectionDecision(decision, state, context, faults);
    return false;
  }
  applyTerminalDecision(decision, state, context);
  return true;
};
