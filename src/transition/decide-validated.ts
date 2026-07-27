import type { PipelineDecision } from '../errors/index.js';
import type { DecisionContext } from './context/decision-context.js';
import { findFirstAction } from './evaluation/find-first-action.js';
import { findFirstWait } from './evaluation/find-first-wait.js';
import { findReachedTerminals } from './evaluation/find-reached-terminals.js';
import { DecisionFaultCollector } from './facts/decision-fault-collector.js';
import type { ValidatedFacts } from './facts/validated-facts.js';

export const decideValidated = (
  facts: ValidatedFacts,
  context: DecisionContext,
): PipelineDecision => {
  const terminals = findReachedTerminals(facts, context);
  if (terminals.length > 1) {
    const faults = new DecisionFaultCollector();
    faults.add('FACT_CAUSAL', '/nodes', 'Multiple terminals are reached.');
    return faults.reject();
  }
  const terminal = terminals[0];
  return terminal
    ? { kind: 'terminal', nodeKey: terminal.key, outcome: terminal.outcome }
    : (findFirstAction(facts, context) ??
        findFirstWait(facts, context) ?? { kind: 'noop', reason: 'quiescent' });
};
