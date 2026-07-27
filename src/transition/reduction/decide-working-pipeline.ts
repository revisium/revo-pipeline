import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import { decideValidated } from '../decide-validated.js';
import { validateFactCausality } from '../evaluation/validate-fact-causality.js';
import { DecisionFaultCollector } from '../facts/decision-fault-collector.js';
import { validatePipelineFacts } from '../facts/validate-pipeline-facts.js';
import { projectWorkingFacts } from './project-working-facts.js';
import type { ReductionDiagnosticCollector } from './reduction-diagnostic-collector.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const decideWorkingPipeline = (
  state: WorkingPipelineState,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): Exclude<PipelineDecision, { readonly kind: 'reject' | 'noop' }> | undefined => {
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
  if (decision.kind === 'reject' || decision.kind === 'noop') {
    faults.add('REDUCTION_INVARIANT', '/reduction', 'Reduction cannot make valid progress.');
    return undefined;
  }
  return decision;
};
