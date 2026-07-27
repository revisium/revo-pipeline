import type { DecisionContext } from '../context/decision-context.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';

export const findReachedTerminals = (
  facts: ValidatedFacts,
  context: DecisionContext,
): readonly { readonly key: string; readonly outcome: string }[] =>
  context.compiled.snapshot.topologicalOrder.flatMap((key) => {
    const node = context.nodeByKey.get(key);
    if (node?.kind !== 'terminal') {
      return [];
    }
    const fact = facts.nodeByKey.get(node.key);
    return fact?.state === 'enabled' ||
      (fact?.state === 'terminal' && fact.outcome === node.outcome)
      ? [{ key: node.key, outcome: node.outcome }]
      : [];
  });
