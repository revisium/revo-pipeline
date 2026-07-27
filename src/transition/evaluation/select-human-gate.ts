import type { PipelineNode } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import type { Selection } from './selection.js';

export const selectHumanGate = (
  node: Extract<PipelineNode, { readonly kind: 'humanGate' }>,
  facts: ValidatedFacts,
  _context: DecisionContext,
): Selection | undefined => {
  const resolution = facts.gateResolutionByNode.get(node.key);
  const route = resolution
    ? node.resolutions.find((candidate) => candidate.resolution === resolution.resolution)
    : undefined;
  return route ? { outcome: route.resolution, targets: [route.to] } : undefined;
};
