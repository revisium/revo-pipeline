import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import { applyWorkingDecision } from './apply-working-decision.js';
import { decideWorkingPipeline } from './decide-working-pipeline.js';
import type { ReductionDiagnosticCollector } from './reduction-diagnostic-collector.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const drainPipeline = (
  state: WorkingPipelineState,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): PipelineDecision | undefined => {
  while (state.applications < 514) {
    const decision = decideWorkingPipeline(state, context, faults);
    if (!decision) {
      return undefined;
    }
    if (decision.kind === 'wait') {
      return decision;
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
    if (applyWorkingDecision(decision, state, context, faults)) {
      return decision;
    }
    if (faults.hasFaults) {
      return undefined;
    }
  }
  return undefined;
};
