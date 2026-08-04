import type { PipelineDecision } from '../errors/index.js';
import type { CompiledPipeline, PipelineFacts } from '../spec/index.js';
import { buildDecisionContext } from './context/build-decision-context.js';
import { decideValidated } from './decide-validated.js';
import { validateFactCausality } from './evaluation/validate-fact-causality.js';
import { DecisionFaultCollector } from './facts/decision-fault-collector.js';
import { validatePipelineFacts } from './facts/validate-pipeline-facts.js';

export const decidePipeline = (
  pipeline: CompiledPipeline,
  factsInput: PipelineFacts,
): PipelineDecision => {
  const context = buildDecisionContext(pipeline);
  if (context === undefined) {
    const invalid = new DecisionFaultCollector();
    invalid.add('PIPELINE_INVALID', '', 'Compiled pipeline is invalid.');
    return invalid.reject();
  }
  const faults = new DecisionFaultCollector();
  const facts = validatePipelineFacts(factsInput, context, faults);
  if (facts) {
    validateFactCausality(facts, context, faults);
  }
  if (faults.hasFaults || !facts) {
    return faults.reject();
  }
  return decideValidated(facts, context);
};
