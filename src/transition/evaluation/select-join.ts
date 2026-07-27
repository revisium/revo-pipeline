import type { PipelineNode } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import type { Selection } from './selection.js';

type JoinOutcome = 'completed' | 'insufficient' | 'rejected';
const outcomeFor = (
  policy: Extract<PipelineNode, { readonly kind: 'join' }>['policy'],
  accepted: number,
  pending: number,
  rejected: boolean,
): JoinOutcome | undefined => {
  if (policy.kind === 'all') {
    if (rejected) {
      return 'rejected';
    }
    if (pending > 0) {
      return undefined;
    }
    return accepted > 0 ? 'completed' : 'insufficient';
  }
  if (policy.kind === 'any') {
    if (accepted > 0) {
      return 'completed';
    }
    if (pending > 0) {
      return undefined;
    }
    return rejected ? 'rejected' : 'insufficient';
  }
  if (accepted >= policy.count) {
    return 'completed';
  }
  if (accepted + pending >= policy.count) {
    return undefined;
  }
  return rejected ? 'rejected' : 'insufficient';
};

export const selectJoin = (
  node: Extract<PipelineNode, { readonly kind: 'join' }>,
  facts: ValidatedFacts,
  context: DecisionContext,
): Selection | undefined => {
  const region = context.regionByJoin.get(node.key);
  if (!region) {
    return undefined;
  }
  const statuses = region.branches.map((branch) => {
    const fact = facts.nodeByKey.get(branch.exit);
    if (fact?.state !== 'terminal') {
      return 'pending' as const;
    }
    if (fact.outcome === 'completed') {
      return 'accepted' as const;
    }
    return fact.outcome === 'skipped' ? ('skipped' as const) : ('rejected' as const);
  });
  const outcome = outcomeFor(
    node.policy,
    statuses.filter((status) => status === 'accepted').length,
    statuses.filter((status) => status === 'pending').length,
    statuses.some((status) => status === 'rejected'),
  );
  return outcome ? { outcome, targets: [node.outcomes[outcome]] } : undefined;
};
