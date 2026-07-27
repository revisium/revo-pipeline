import type { PipelineDecision } from '../errors/index.js';
import type { CompiledPipeline, PipelineFacts } from '../spec/index.js';
import { validateCompiledInternally } from './compiled/validate-compiled-internally.js';
import { buildDecisionContext } from './context/build-decision-context.js';
import { findFirstAction } from './evaluation/find-first-action.js';
import { findFirstWait } from './evaluation/find-first-wait.js';
import { findReachedTerminals } from './evaluation/find-reached-terminals.js';
import { validateFactCausality } from './evaluation/validate-fact-causality.js';
import { DecisionFaultCollector } from './facts/decision-fault-collector.js';
import { validatePipelineFacts } from './facts/validate-pipeline-facts.js';

export const decidePipeline = (
  pipelineInput: CompiledPipeline,
  factsInput: PipelineFacts,
): PipelineDecision => {
  const compiled = validateCompiledInternally(pipelineInput);
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
  const terminals = findReachedTerminals(facts, context);
  if (terminals.length > 1) {
    faults.add('FACT_CAUSAL', '/nodes', 'Multiple terminals are reached.');
    return faults.reject();
  }
  const terminal = terminals[0];
  if (terminal) {
    return { kind: 'terminal', nodeKey: terminal.key, outcome: terminal.outcome };
  }
  return (
    findFirstAction(facts, context) ??
    findFirstWait(facts, context) ?? { kind: 'noop', reason: 'quiescent' }
  );
};
