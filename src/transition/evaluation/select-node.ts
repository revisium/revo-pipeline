import type { PipelineNode } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import { selectBranch } from './select-branch.js';
import { selectConsensus } from './select-consensus.js';
import { selectFork } from './select-fork.js';
import { selectHumanGate } from './select-human-gate.js';
import { selectJoin } from './select-join.js';
import type { Selection } from './selection.js';

export const selectNode = (
  node: Exclude<PipelineNode, { readonly kind: 'task' | 'terminal' }>,
  facts: ValidatedFacts,
  context: DecisionContext,
): Selection | undefined => {
  if (node.kind === 'branch') {
    return selectBranch(node, facts);
  }
  if (node.kind === 'fork') {
    return selectFork(node, facts, context);
  }
  if (node.kind === 'join') {
    return selectJoin(node, facts, context);
  }
  if (node.kind === 'consensus') {
    return selectConsensus(node, facts, context);
  }
  return selectHumanGate(node, facts, context);
};
