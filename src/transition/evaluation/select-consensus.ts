import type { PipelineNode } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import type { Selection } from './selection.js';

type ConsensusOutcome = 'approved' | 'insufficient' | 'rejected' | 'tied';

const unanimousOutcome = (
  candidateCount: number,
  approvals: number,
  rejections: number,
  remaining: number,
): ConsensusOutcome | undefined => {
  if (rejections > 0) {
    return 'rejected';
  }
  if (remaining > 0) {
    return undefined;
  }
  return approvals === candidateCount ? 'approved' : 'insufficient';
};

const quorumOutcome = (
  quorum: number,
  approvals: number,
  rejections: number,
  remaining: number,
): ConsensusOutcome | undefined => {
  if (remaining > 0) {
    return undefined;
  }
  if (approvals + rejections < quorum) {
    return 'insufficient';
  }
  if (approvals > rejections) {
    return 'approved';
  }
  return rejections > approvals ? 'rejected' : 'tied';
};

const outcomeFor = (
  node: Extract<PipelineNode, { readonly kind: 'consensus' }>,
  approvals: number,
  rejections: number,
  remaining: number,
): ConsensusOutcome | undefined => {
  if (node.policy.kind === 'unanimous') {
    return unanimousOutcome(node.candidates.length, approvals, rejections, remaining);
  }
  if (node.policy.kind === 'quorum') {
    return quorumOutcome(node.policy.quorum, approvals, rejections, remaining);
  }
  if (approvals >= node.policy.approve) {
    return 'approved';
  }
  if (rejections >= node.policy.reject) {
    return 'rejected';
  }
  if (approvals + remaining < node.policy.approve && rejections + remaining < node.policy.reject) {
    return 'insufficient';
  }
  return undefined;
};

export const selectConsensus = (
  node: Extract<PipelineNode, { readonly kind: 'consensus' }>,
  facts: ValidatedFacts,
  _context: DecisionContext,
): Selection | undefined => {
  const aggregate = facts.consensusByNode.get(node.key);
  const outcome = outcomeFor(
    node,
    aggregate?.approvals ?? 0,
    aggregate?.rejections ?? 0,
    node.candidates.length - (aggregate?.total ?? 0),
  );
  return outcome ? { outcome, targets: [node.outcomes[outcome]] } : undefined;
};
