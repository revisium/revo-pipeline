import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import { selectNode } from './select-node.js';

type WaitReason = Extract<PipelineDecision, { readonly kind: 'wait' }>['reason'];

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
    let reason: WaitReason | undefined;
    let selection: ReturnType<typeof selectNode> = undefined;
    switch (node?.kind) {
      case 'task':
        return { kind: 'wait', nodeKey: key, reason: 'task-incomplete' };
      case 'branch':
        if (!facts.valueByKey.has(node.fact)) {
          return { kind: 'wait', nodeKey: key, reason: 'branch-fact-missing' };
        }
        break;
      case 'join':
        selection = selectNode(node, facts, context);
        reason = 'join-incomplete';
        break;
      case 'consensus':
        selection = selectNode(node, facts, context);
        reason = 'consensus-incomplete';
        break;
      case 'humanGate':
        selection = selectNode(node, facts, context);
        reason = 'gate-unresolved';
        break;
      case 'fork':
      case 'terminal':
      case undefined:
        break;
    }
    if (reason && !selection) {
      return { kind: 'wait', nodeKey: key, reason };
    }
  }
  return undefined;
};
