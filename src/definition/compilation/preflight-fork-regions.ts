import type { BarrierRegionQuery } from '../../graph/index.js';
import type { PipelineNode } from '../../spec/index.js';
import type { DefinitionValidationResult } from '../contracts/definition-validation-result.js';

type ForkNode = Extract<PipelineNode, { readonly kind: 'fork' }>;
type JoinNode = Extract<PipelineNode, { readonly kind: 'join' }>;
type ForkBranchPreflight = {
  readonly branch: ForkNode['branches'][number];
  readonly branchPath: string;
};
type ForkRegionPreflight = {
  readonly branches: readonly ForkBranchPreflight[];
  readonly fork: ForkNode;
  readonly join: JoinNode;
  readonly queryIndex: number | undefined;
};
type RegionPreflight = {
  readonly forks: readonly ForkRegionPreflight[];
  readonly queries: readonly BarrierRegionQuery[];
};

const sourceBranchIndex = (
  fork: ForkNode,
  branch: (typeof fork.branches)[number],
  sourceNodes: ReadonlyMap<string, PipelineNode>,
): number => {
  const sourceFork = sourceNodes.get(fork.key);
  if (sourceFork?.kind !== 'fork') {
    return 0;
  }
  return sourceFork.branches.findIndex(
    (candidate) =>
      candidate.name === branch.name &&
      candidate.entry === branch.entry &&
      candidate.exit === branch.exit,
  );
};

const validateJoinThreshold = (
  join: JoinNode,
  branchCount: number,
  sourceIndexes: ReadonlyMap<string, number>,
  faults: DefinitionValidationResult['faults'],
): void => {
  if (join.policy.kind !== 'threshold') {
    return;
  }
  const { count } = join.policy;
  if (!Number.isSafeInteger(count) || count < 1 || count > branchCount) {
    faults.push({
      code: 'DEF_JOIN_THRESHOLD',
      path: `/nodes/${sourceIndexes.get(join.key) ?? 0}/policy/count`,
      message: 'Join threshold exceeds branch count.',
    });
  }
};

export const preflightForkRegions = (
  nodes: readonly PipelineNode[],
  nodeKeys: readonly string[],
  sourceIndexes: ReadonlyMap<string, number>,
  sourceNodes: ReadonlyMap<string, PipelineNode>,
  faults: DefinitionValidationResult['faults'],
): RegionPreflight => {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const nodeOffsets = new Map(nodeKeys.map((key, offset) => [key, offset]));
  const queries: BarrierRegionQuery[] = [];
  const forks: ForkRegionPreflight[] = [];
  for (const fork of nodes.filter((node): node is ForkNode => node.kind === 'fork')) {
    const forkPath = `/nodes/${sourceIndexes.get(fork.key) ?? 0}`;
    const join = nodeByKey.get(fork.join);
    if (join?.kind !== 'join' || join.fork !== fork.key) {
      faults.push({
        code: 'DEF_FORK_JOIN',
        path: `${forkPath}/join`,
        message: 'Fork/join is not reciprocal.',
      });
      continue;
    }
    validateJoinThreshold(join, fork.branches.length, sourceIndexes, faults);
    const branches = fork.branches.map((branch) => ({
      branch,
      branchPath: `${forkPath}/branches/${sourceBranchIndex(fork, branch, sourceNodes)}`,
    }));
    const barrierNodeOffset = nodeOffsets.get(join.key);
    const queryBranches = branches.map(({ branch }) => ({
      entryNodeOffset: nodeOffsets.get(branch.entry),
      exitNodeOffset: nodeOffsets.get(branch.exit),
    }));
    const queryIsKnown =
      barrierNodeOffset !== undefined &&
      queryBranches.every(
        (branch) => branch.entryNodeOffset !== undefined && branch.exitNodeOffset !== undefined,
      );
    const queryIndex = queryIsKnown ? queries.length : undefined;
    if (queryIsKnown) {
      queries.push({
        barrierNodeOffset,
        branches: queryBranches.map((branch) => ({
          entryNodeOffset: branch.entryNodeOffset!,
          exitNodeOffset: branch.exitNodeOffset!,
        })),
      });
    }
    forks.push({ branches, fork, join, queryIndex });
  }
  for (const join of nodes.filter((node) => node.kind === 'join')) {
    const fork = nodeByKey.get(join.fork);
    if (fork?.kind !== 'fork' || fork.join !== join.key) {
      faults.push({
        code: 'DEF_FORK_JOIN',
        path: `/nodes/${sourceIndexes.get(join.key) ?? 0}/fork`,
        message: 'Join/fork is not reciprocal.',
      });
    }
  }
  return { forks, queries };
};
