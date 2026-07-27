import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import { selectNode } from './select-node.js';

export const findFirstAction = (
  facts: ValidatedFacts,
  context: DecisionContext,
): PipelineDecision | undefined => {
  const pipeline = context.compiled.snapshot;
  const byNode = facts.nodeByKey;
  if (!byNode.has(pipeline.entry)) {
    return { kind: 'activate', cause: { kind: 'entry' }, nodeKeys: [pipeline.entry] };
  }
  for (const key of pipeline.topologicalOrder) {
    const node = context.nodeByKey.get(key);
    const fact = byNode.get(key);
    if (node?.kind === 'task' && fact?.state === 'terminal') {
      const edge = (context.outgoingByKey.get(key) ?? [])
        .map((edgeOffset) => pipeline.edges[edgeOffset])
        .find((candidate) => candidate?.outcome === fact.outcome);
      if (edge && !byNode.has(edge.to)) {
        return {
          kind: 'activate',
          cause: { kind: 'node', nodeKey: key, outcome: fact.outcome },
          nodeKeys: [edge.to],
        };
      }
    }
    if (!node || node.kind === 'task' || node.kind === 'terminal' || fact?.state !== 'enabled') {
      continue;
    }
    const selection = selectNode(node, facts, context);
    const activate = selection?.targets.filter((target) => !byNode.has(target)) ?? [];
    if (selection && activate.length > 0) {
      return { kind: 'select', nodeKey: key, outcome: selection.outcome, activate };
    }
  }
  return undefined;
};
