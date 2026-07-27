import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import { decideValidated } from '../decide-validated.js';
import { validateFactCausality } from '../evaluation/validate-fact-causality.js';
import { DecisionFaultCollector } from '../facts/decision-fault-collector.js';
import { validatePipelineFacts } from '../facts/validate-pipeline-facts.js';
import { applyActivationDecision } from './apply-activation-decision.js';
import { applySelectionDecision } from './apply-selection-decision.js';
import { applyTerminalDecision } from './apply-terminal-decision.js';
import { projectWorkingFacts } from './project-working-facts.js';
import type { ReductionDiagnosticCollector } from './reduction-diagnostic-collector.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const drainPipeline = (
  state: WorkingPipelineState,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): PipelineDecision | undefined => {
  while (state.applications < 514) {
    const factFaults = new DecisionFaultCollector();
    const facts = validatePipelineFacts(projectWorkingFacts(state), context, factFaults);
    if (facts) {
      validateFactCausality(facts, context, factFaults);
    }
    if (!facts || factFaults.hasFaults) {
      faults.add('REDUCTION_INVARIANT', '/reduction', 'Working facts are invalid.');
      return undefined;
    }
    const decision = decideValidated(facts, context);
    if (decision.kind === 'wait') {
      return decision;
    }
    if (decision.kind === 'reject' || decision.kind === 'noop') {
      faults.add('REDUCTION_INVARIANT', '/reduction', 'Reduction cannot make valid progress.');
      return undefined;
    }
    state.applications += 1;
    if (state.applications > 513) {
      faults.add(
        'REDUCTION_STEP_LIMIT',
        '/reduction/steps',
        'Pipeline reduction step limit exceeded.',
      );
      return undefined;
    }
    if (decision.kind === 'activate') {
      applyActivationDecision(decision, state, context, faults);
    } else if (decision.kind === 'select') {
      applySelectionDecision(decision, state, context, faults);
    } else {
      applyTerminalDecision(decision, state, context);
      return decision;
    }
    if (faults.hasFaults) {
      return undefined;
    }
  }
  return undefined;
};
