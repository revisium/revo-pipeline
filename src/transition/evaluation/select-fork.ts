import type { PipelineNode } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import type { Selection } from './selection.js';

export const selectFork = (
  node: Extract<PipelineNode, { readonly kind: 'fork' }>,
  _facts: ValidatedFacts,
  context: DecisionContext,
): Selection | undefined => {
  const region = context.regionByFork.get(node.key);
  return region
    ? {
        outcome: 'forked',
        targets: [...region.branches.map((branch) => branch.entry), region.join].sort(
          (left, right) =>
            (context.topologicalPosition.get(left) ?? 0) -
            (context.topologicalPosition.get(right) ?? 0),
        ),
      }
    : undefined;
};
