import type {
  GenericParallelBranchResult,
  ProgramParallelNode,
  VoteParallelBranchResult,
} from '../../../program/index.js';

type GenericNode = Extract<ProgramParallelNode, { readonly mode: 'generic' }>;
type VoteNode = Extract<ProgramParallelNode, { readonly mode: 'votes' }>;

export type GenericSelection = 'completed' | 'impossible' | 'failed' | 'cancelled';
export type VoteSelection =
  | 'approved'
  | 'rejected'
  | 'inconclusive'
  | 'participantFailed'
  | 'cancelled';

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

export const classifyGenericParallel = (
  node: GenericNode,
  results: Readonly<Record<string, GenericParallelBranchResult>>,
  selected: GenericSelection | null,
): GenericSelection | null => {
  if (selected !== null) {
    return selected;
  }
  let qualified = 0;
  let doesNotQualify = 0;
  for (const branch of node.branches) {
    const result = results[branch.key];
    if (result === undefined) {
      continue;
    }
    const classification = genericClassification(node, branch.key, result);
    if (classification === 'failed') {
      return 'failed';
    }
    if (classification === 'cancelled') {
      return 'failed';
    }
    if (classification === 'qualifies') {
      qualified += 1;
    } else {
      doesNotQualify += 1;
    }
  }
  const pending = node.branches.length - qualified - doesNotQualify;
  if (node.policy.kind === 'all') {
    return doesNotQualify > 0 ? 'impossible' : pending === 0 ? 'completed' : null;
  }
  if (node.policy.kind === 'any') {
    return qualified > 0 ? 'completed' : pending === 0 ? 'impossible' : null;
  }
  if (qualified >= node.policy.count) {
    return 'completed';
  }
  return qualified + pending < node.policy.count ? 'impossible' : null;
};

const voteCounts = (results: Readonly<Record<string, VoteParallelBranchResult>>) => {
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
    if (counts.reject > 0) {
      return 'rejected';
    }
    if (pending > 0) {
      return null;
    }
    return counts.abstain > 0 ? 'inconclusive' : 'approved';
  }
  if (node.policy.kind === 'quorum') {
    if (pending > 0) {
      return null;
    }
    const participation = counts.approve + counts.reject;
    if (participation < node.policy.minimumParticipation || counts.approve === counts.reject) {
      return 'inconclusive';
    }
    return counts.approve > counts.reject ? 'approved' : 'rejected';
  }
  if (counts.approve >= node.policy.approveThreshold) {
    return 'approved';
  }
  if (counts.reject >= node.policy.rejectThreshold) {
    return 'rejected';
  }
  const approveReachable = counts.approve + pending >= node.policy.approveThreshold;
  const rejectReachable = counts.reject + pending >= node.policy.rejectThreshold;
  return approveReachable || rejectReachable ? null : 'inconclusive';
};
