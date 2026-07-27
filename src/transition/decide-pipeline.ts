import type { PipelineDecision } from '../errors/index.js';
import type { CompiledPipeline, PipelineFacts } from '../spec/index.js';
import { buildDecisionContext } from './context/build-decision-context.js';
import { decideValidated } from './decide-validated.js';
import { validateFactCausality } from './evaluation/validate-fact-causality.js';
import { DecisionFaultCollector } from './facts/decision-fault-collector.js';
import { validatePipelineFacts } from './facts/validate-pipeline-facts.js';
import { inspectCompiledPipeline } from './inspect-compiled-pipeline.js';

export const decidePipeline = (
  pipelineInput: CompiledPipeline,
  factsInput: PipelineFacts,
): PipelineDecision => {
  const compiled = inspectCompiledPipeline(pipelineInput);
  if (!compiled.ok) {
    const invalid = new DecisionFaultCollector();
    invalid.add('PIPELINE_INVALID', '', 'Compiled pipeline is invalid.');
    return invalid.reject();
  }
  const context = buildDecisionContext(compiled);
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
