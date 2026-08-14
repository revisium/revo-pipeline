import {
  EmptyObjectSchema,
  PipelineFailureValueSchema,
  canonicalizeOwnedValue,
  compareUnicodeCodePoints,
  escapeJsonPointerToken,
  valueSchemasEqual,
} from '../../foundation/index.js';
import type {
  ProgramActivityNode,
  ProgramEndNode,
  ProgramParallelNode,
  ProgramValueMapping,
  ProgramVoteBranch,
} from '../contracts/index.js';
import {
  ConsensusParticipantRegionOutputSchema,
  VoteExitSchema,
  VoteValueSchema,
} from '../derived-schemas.js';

type VoteParallelNode = Extract<ProgramParallelNode, { readonly mode: 'votes' }>;

const hasIdentityInput = (
  branchInput: ProgramValueMapping,
  activityInput: ProgramValueMapping,
): boolean => {
  const keys = Object.keys(branchInput).toSorted(compareUnicodeCodePoints);
  const activityKeys = Object.keys(activityInput).toSorted(compareUnicodeCodePoints);
  return (
    keys.length === activityKeys.length &&
    keys.every((key, index) => {
      const selector = activityInput[key];
      return (
        key === activityKeys[index] &&
        selector?.kind === 'scopeInput' &&
        selector.pointer === `/${escapeJsonPointerToken(key)}`
      );
    })
  );
};

const endByOutcome = (nodes: readonly ProgramEndNode[], outcome: string): ProgramEndNode | null =>
  nodes.find((node) => node.outcome === outcome) ?? null;

const equalValue = (left: unknown, right: unknown): boolean =>
  canonicalizeOwnedValue(left).text === canonicalizeOwnedValue(right).text;

const hasExactEnds = (activity: ProgramActivityNode, nodes: readonly ProgramEndNode[]): boolean => {
  const vote = endByOutcome(nodes, 'vote');
  const failed = endByOutcome(nodes, 'failed');
  const cancelled = endByOutcome(nodes, 'cancelled');
  return (
    vote !== null &&
    failed !== null &&
    cancelled !== null &&
    activity.routes.succeeded === vote.id &&
    activity.routes.failed === failed.id &&
    activity.routes.cancelled === cancelled.id &&
    equalValue(vote.output, { vote: { kind: 'nodeOutput', nodeId: activity.id, pointer: '' } }) &&
    equalValue(failed.output, {
      code: { kind: 'nodeFailure', nodeId: activity.id, pointer: '/code' },
      path: { kind: 'nodeFailure', nodeId: activity.id, pointer: '/path' },
    }) &&
    Object.keys(cancelled.output).length === 0
  );
};

const hasExactExits = (branch: ProgramVoteBranch): boolean => {
  const exits = branch.region.exits;
  return (
    exits.length === 3 &&
    exits[0]?.outcome === 'cancelled' &&
    valueSchemasEqual(exits[0].outputSchema, EmptyObjectSchema) &&
    exits[1]?.outcome === 'failed' &&
    valueSchemasEqual(exits[1].outputSchema, PipelineFailureValueSchema) &&
    exits[2]?.outcome === 'vote' &&
    valueSchemasEqual(exits[2].outputSchema, VoteExitSchema)
  );
};

const hasValidVoteBranch = (branch: ProgramVoteBranch): boolean => {
  const activities = branch.region.nodes.filter(
    (node): node is ProgramActivityNode => node.kind === 'activity',
  );
  const ends = branch.region.nodes.filter((node): node is ProgramEndNode => node.kind === 'end');
  const activity = activities[0];
  return (
    branch.region.nodes.length === 4 &&
    activities.length === 1 &&
    ends.length === 3 &&
    activity?.activityKind === 'agent' &&
    branch.region.entry === activity.id &&
    activity.requirementKey === branch.bindingKey &&
    valueSchemasEqual(branch.region.inputSchema, activity.inputSchema) &&
    valueSchemasEqual(activity.outputSchema, VoteValueSchema) &&
    valueSchemasEqual(branch.region.outputSchema, ConsensusParticipantRegionOutputSchema) &&
    hasIdentityInput(branch.input, activity.input) &&
    hasExactEnds(activity, ends) &&
    hasExactExits(branch)
  );
};

export const hasValidVoteTopology = (node: VoteParallelNode): boolean =>
  node.branches.every(hasValidVoteBranch);
