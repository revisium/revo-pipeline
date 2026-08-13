import type {
  GenericParallelBranchResult,
  ProgramParallelNode,
  VoteParallelBranchResult,
} from '../../../program/index.js';

type GenericNode = Extract<ProgramParallelNode, { readonly mode: 'generic' }>;
type VoteNode = Extract<ProgramParallelNode, { readonly mode: 'votes' }>;
type QuorumPolicy = Extract<VoteNode['policy'], { readonly kind: 'quorum' }>;
type IndependentThresholdPolicy = Extract<
  VoteNode['policy'],
  { readonly kind: 'independentThreshold' }
>;

export type GenericSelection = 'completed' | 'impossible' | 'failed' | 'cancelled';
export type VoteSelection =
  | 'approved'
  | 'rejected'
  | 'inconclusive'
  | 'participantFailed'
  | 'cancelled';

type GenericCounts = {
  readonly qualified: number;
  readonly doesNotQualify: number;
};

type VoteCounts = {
  readonly approve: number;
  readonly reject: number;
  readonly abstain: number;
  readonly failed: number;
  readonly cancelled: number;
};

const genericClassification = (
  node: GenericNode,
  branchKey: string,
  result: GenericParallelBranchResult,
): string => {
  if (result.status !== 'completed') {
    return result.status;
  }
  const branch = node.branches.find(({ key }) => key === branchKey);
  return (
    branch?.exits.find(({ outcome }) => outcome === result.outcome)?.classification ?? 'failed'
  );
};

const countGenericResults = (
  node: GenericNode,
  results: Readonly<Record<string, GenericParallelBranchResult>>,
): GenericCounts | null => {
  let qualified = 0;
  let doesNotQualify = 0;
  for (const branch of node.branches) {
    const result = results[branch.key];
    if (result === undefined) {
      continue;
    }
    const classification = genericClassification(node, branch.key, result);
    if (classification === 'failed' || classification === 'cancelled') {
      return null;
    }
    if (classification === 'qualifies') {
      qualified += 1;
    } else {
      doesNotQualify += 1;
    }
  }
  return Object.freeze({ qualified, doesNotQualify });
};

const selectGenericPolicy = (node: GenericNode, counts: GenericCounts): GenericSelection | null => {
  const pending = node.branches.length - counts.qualified - counts.doesNotQualify;
  if (node.policy.kind === 'all') {
    if (counts.doesNotQualify > 0) {
      return 'impossible';
    }
    return pending === 0 ? 'completed' : null;
  }
  if (node.policy.kind === 'any') {
    if (counts.qualified > 0) {
      return 'completed';
    }
    return pending === 0 ? 'impossible' : null;
  }
  if (counts.qualified >= node.policy.count) {
    return 'completed';
  }
  return counts.qualified + pending < node.policy.count ? 'impossible' : null;
};

export const classifyGenericParallel = (
  node: GenericNode,
  results: Readonly<Record<string, GenericParallelBranchResult>>,
  selected: GenericSelection | null,
): GenericSelection | null => {
  if (selected !== null) {
    return selected;
  }
  const counts = countGenericResults(node, results);
  return counts === null ? 'failed' : selectGenericPolicy(node, counts);
};

const voteCounts = (results: Readonly<Record<string, VoteParallelBranchResult>>): VoteCounts => {
  let approve = 0;
  let reject = 0;
  let abstain = 0;
  let failed = 0;
  let cancelled = 0;
  for (const result of Object.values(results)) {
    if (result.status === 'failed') {
      failed += 1;
    } else if (result.status === 'cancelled') {
      cancelled += 1;
    } else if (result.vote === 'approve') {
      approve += 1;
    } else if (result.vote === 'reject') {
      reject += 1;
    } else {
      abstain += 1;
    }
  }
  return { approve, reject, abstain, failed, cancelled };
};

const selectUnanimous = (counts: VoteCounts, pending: number): VoteSelection | null => {
  if (counts.reject > 0) {
    return 'rejected';
  }
  if (pending > 0) {
    return null;
  }
  return counts.abstain > 0 ? 'inconclusive' : 'approved';
};

const selectQuorum = (
  policy: QuorumPolicy,
  counts: VoteCounts,
  pending: number,
): VoteSelection | null => {
  if (pending > 0) {
    return null;
  }
  const participation = counts.approve + counts.reject;
  if (participation < policy.minimumParticipation || counts.approve === counts.reject) {
    return 'inconclusive';
  }
  return counts.approve > counts.reject ? 'approved' : 'rejected';
};

const selectIndependentThreshold = (
  policy: IndependentThresholdPolicy,
  counts: VoteCounts,
  pending: number,
): VoteSelection | null => {
  if (counts.approve >= policy.approveThreshold) {
    return 'approved';
  }
  if (counts.reject >= policy.rejectThreshold) {
    return 'rejected';
  }
  const approveReachable = counts.approve + pending >= policy.approveThreshold;
  const rejectReachable = counts.reject + pending >= policy.rejectThreshold;
  return approveReachable || rejectReachable ? null : 'inconclusive';
};

export const classifyVoteParallel = (
  node: VoteNode,
  results: Readonly<Record<string, VoteParallelBranchResult>>,
  selected: VoteSelection | null,
): VoteSelection | null => {
  if (selected !== null) {
    return selected;
  }
  const counts = voteCounts(results);
  if (counts.failed > 0) {
    return 'participantFailed';
  }
  if (counts.cancelled > 0) {
    return 'participantFailed';
  }
  const pending = node.branches.length - Object.keys(results).length;
  if (node.policy.kind === 'unanimous') {
    return selectUnanimous(counts, pending);
  }
  if (node.policy.kind === 'quorum') {
    return selectQuorum(node.policy, counts, pending);
  }
  return selectIndependentThreshold(node.policy, counts, pending);
};
