import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import { selectNode } from './select-node.js';

export const findFirstWait = (
  facts: ValidatedFacts,
  context: DecisionContext,
): PipelineDecision | undefined => {
  for (const key of context.compiled.snapshot.topologicalOrder) {
    const node = context.nodeByKey.get(key);
    const fact = facts.nodeByKey.get(key);
    if (fact?.state !== 'enabled') {
      continue;
    }
    if (node?.kind === 'task') {
      return { kind: 'wait', nodeKey: key, reason: 'task-incomplete' };
    }
    if (node?.kind === 'branch' && !facts.valueByKey.has(node.fact)) {
      return { kind: 'wait', nodeKey: key, reason: 'branch-fact-missing' };
    }
    if (node?.kind === 'join' && !selectNode(node, facts, context)) {
      return { kind: 'wait', nodeKey: key, reason: 'join-incomplete' };
    }
    if (node?.kind === 'consensus' && !selectNode(node, facts, context)) {
      return { kind: 'wait', nodeKey: key, reason: 'consensus-incomplete' };
    }
    if (node?.kind === 'humanGate' && !selectNode(node, facts, context)) {
      return { kind: 'wait', nodeKey: key, reason: 'gate-unresolved' };
    }
  }
  return undefined;
};
