import { compareUnicodeCodePoints, type JsonValue } from '../../../foundation/index.js';
import type {
  GenericParallelBranchResult,
  ProgramParallelNode,
  VoteParallelBranchResult,
} from '../../../program/index.js';
import type { ParallelBranchMachineFrame } from '../../contracts/region-frames.js';
import type { RegionTerminalResult } from '../../contracts/results.js';
import type { ParallelMachineFrame } from '../../contracts/structured-frames.js';
import {
  pendingAncestorKeys,
  pruneFrameTree,
  pruneFrameTrees,
  requestRegionCancellation,
} from './cancellation.js';
import { consumeCleanupOwner } from './cleanup-context.js';
import type { CancellationCausality, RuntimeContext } from './context.js';
import { routeOwnedResult, storeOwnedResult } from './parent-result.js';
import { classifyGenericParallel, classifyVoteParallel } from './policies.js';
import { findRuntimeNode, resolveRuntimeRegion } from './program-index.js';
import { cancelledNode, succeededNode, readPipelineFailure } from './results.js';

const ownerNode = (
  context: RuntimeContext,
  owner: ParallelMachineFrame,
): ProgramParallelNode | null => {
  const region = resolveRuntimeRegion(owner.parentFrameKey, context.draft, context.index);
  const node = region === null ? null : findRuntimeNode(context.index, region.region, owner.nodeId);
  return node?.kind === 'parallel' ? node : null;
};

const genericResult = (
  node: Extract<ProgramParallelNode, { readonly mode: 'generic' }>,
  branchKey: string,
  result: RegionTerminalResult,
): GenericParallelBranchResult => {
  if (result.status === 'failed' || result.status === 'cancelled') {
    return result;
  }
  const classification = node.branches
    .find(({ key }) => key === branchKey)
    ?.exits.find(({ outcome }) => outcome === result.outcome)?.classification;
  if (classification === 'failed') {
    return Object.freeze({ status: 'failed', failure: readPipelineFailure(result.output) });
  }
  if (classification === 'cancelled') {
    return Object.freeze({ status: 'cancelled' });
  }
  return Object.freeze({ status: 'completed', outcome: result.outcome, output: result.output });
};

const voteResult = (result: RegionTerminalResult): VoteParallelBranchResult => {
  if (result.status === 'failed' || result.status === 'cancelled') {
    return result;
  }
  if (result.outcome === 'failed') {
    return Object.freeze({ status: 'failed', failure: readPipelineFailure(result.output) });
  }
  if (result.outcome === 'cancelled') {
    return Object.freeze({ status: 'cancelled' });
  }
  const descriptor =
    typeof result.output === 'object' && result.output !== null && !Array.isArray(result.output)
      ? Reflect.getOwnPropertyDescriptor(result.output, 'vote')
      : undefined;
  const candidate: unknown =
    descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  const vote = candidate;
  return vote === 'approve' || vote === 'reject' || vote === 'abstain'
    ? Object.freeze({ status: 'vote', vote })
    : Object.freeze({
        status: 'failed',
        failure: Object.freeze({ code: 'DATA_SCHEMA_MISMATCH', path: '' }),
      });
};

const withBranchResult = (
  owner: ParallelMachineFrame,
  node: ProgramParallelNode,
  branchKey: string,
  result: RegionTerminalResult,
  causality: CancellationCausality | null,
): ParallelMachineFrame => {
  const branchRegionKeys = Object.freeze(
    Object.fromEntries(Object.entries(owner.branchRegionKeys).filter(([key]) => key !== branchKey)),
  );
  if (owner.mode === 'generic' && node.mode === 'generic') {
    const branchResults = canonicalRecord([
      ...Object.entries(owner.branchResults),
      [branchKey, genericResult(node, branchKey, result)],
    ]);
    const selected = classifyGenericParallel(node, branchResults, owner.selected);
    return Object.freeze({
      ...owner,
      branchRegionKeys,
      branchResults,
      selected:
        owner.selected === null &&
        branchResults[branchKey]?.status === 'cancelled' &&
        causality !== null &&
        causality !== 'isolated'
          ? 'cancelled'
          : selected,
    });
  }
  if (owner.mode === 'votes' && node.mode === 'votes') {
    const branchResults = canonicalRecord([
      ...Object.entries(owner.branchResults),
      [branchKey, voteResult(result)],
    ]);
    const selected = classifyVoteParallel(node, branchResults, owner.selected);
    return Object.freeze({
      ...owner,
      branchRegionKeys,
      branchResults,
      selected:
        owner.selected === null &&
        branchResults[branchKey]?.status === 'cancelled' &&
        causality !== null &&
        causality !== 'isolated'
          ? 'cancelled'
          : selected,
    });
  }
  return owner;
};

const canonicalRecord = <Value>(
  entries: readonly (readonly [string, Value])[],
): Readonly<Record<string, Value>> =>
  Object.freeze(
    Object.fromEntries(
      [...entries].sort(([left], [right]) => compareUnicodeCodePoints(left, right)),
    ),
  );

const cancelUnstartedBranches = (
  context: RuntimeContext,
  owner: ParallelMachineFrame,
): ParallelMachineFrame => {
  const cancelledEntries: [string, { readonly status: 'cancelled' }][] = [];
  const branchRegionKeyEntries: [string, ParallelMachineFrame['key']][] = [];
  const live = pendingAncestorKeys(context.draft);
  const idle: ParallelMachineFrame['key'][] = [];
  for (const [branchKey, frameKey] of Object.entries(owner.branchRegionKeys)) {
    if (live.has(frameKey)) {
      branchRegionKeyEntries.push([branchKey, frameKey]);
    } else {
      idle.push(frameKey);
      cancelledEntries.push([branchKey, Object.freeze({ status: 'cancelled' })]);
    }
  }
  if (!pruneFrameTrees(context.draft, idle, context.discard)) {
    return owner;
  }
  const branchRegionKeys = canonicalRecord(branchRegionKeyEntries);
  const cancelled = canonicalRecord(cancelledEntries);
  if (owner.mode === 'generic') {
    return Object.freeze({
      ...owner,
      mode: 'generic',
      branchRegionKeys,
      branchResults: canonicalRecord([
        ...Object.entries(owner.branchResults),
        ...Object.entries(cancelled),
      ]),
    });
  }
  return Object.freeze({
    ...owner,
    mode: 'votes',
    branchRegionKeys,
    branchResults: canonicalRecord([
      ...Object.entries(owner.branchResults),
      ...Object.entries(cancelled),
    ]),
  });
};

const withCleanupSelection = (
  owner: ParallelMachineFrame,
  previous: ParallelMachineFrame,
): ParallelMachineFrame => {
  if (owner.mode === 'generic' && previous.mode === 'generic') {
    return Object.freeze({
      ...owner,
      selected: previous.selected ?? 'cancelled',
      status: 'draining',
    });
  }
  if (owner.mode === 'votes' && previous.mode === 'votes') {
    return Object.freeze({
      ...owner,
      selected: previous.selected ?? 'cancelled',
      status: 'draining',
    });
  }
  return owner;
};

const storeCompletedBranch = (
  context: RuntimeContext,
  owner: ParallelMachineFrame,
  node: ProgramParallelNode,
  requested: boolean,
  wasSelected: boolean,
): boolean => {
  let updated = owner;
  if (requested) {
    context.draft.setFrame(updated);
  } else if (!wasSelected && updated.selected !== null) {
    const cancelling = updated.selected !== 'cancelled' && node.remaining === 'cancel';
    updated = Object.freeze({ ...updated, status: cancelling ? 'cancelling' : 'draining' });
    context.draft.setFrame(updated);
    if (cancelling) {
      updated = cancelUnstartedBranches(context, updated);
      context.draft.setFrame(updated);
      if (!requestRegionCancellation(context.draft, updated, 'POLICY_SELECTED')) {
        return false;
      }
    }
  } else {
    context.draft.setFrame(updated);
  }
  context.enqueue(updated.key);
  return true;
};

export const completeParallelBranch = (
  context: RuntimeContext,
  frame: ParallelBranchMachineFrame,
  result: RegionTerminalResult,
  causality: CancellationCausality | null = null,
): boolean => {
  const current = context.draft.frames.get(frame.parentFrameKey);
  if (current?.kind !== 'parallel') {
    return false;
  }
  const node = ownerNode(context, current);
  if (node === null || !pruneFrameTree(context.draft, frame.key)) {
    return false;
  }
  const wasSelected = current.selected !== null;
  let owner = withBranchResult(current, node, frame.branchKey, result, causality);
  const requested = causality !== null && causality !== 'isolated' ? causality : null;
  const cleanupOwner = requested === null ? null : consumeCleanupOwner(requested, owner.key);
  if (cleanupOwner?.captured === true && current.selected === null) {
    return false;
  }
  if (cleanupOwner !== null) {
    owner = withCleanupSelection(owner, current);
    owner = cancelUnstartedBranches(context, owner);
    context.markCleanup(owner.key, cleanupOwner.remaining);
  }
  context.draft.charge(2);
  return storeCompletedBranch(context, owner, node, requested !== null, wasSelected);
};

const outputFor = (owner: ParallelMachineFrame): JsonValue =>
  owner.mode === 'generic'
    ? Object.freeze({ classification: owner.selected, branches: owner.branchResults })
    : Object.freeze({ classification: owner.selected, votes: owner.branchResults });

export const settleParallelOwner = (
  context: RuntimeContext,
  owner: ParallelMachineFrame,
): boolean => {
  const node = ownerNode(context, owner);
  if (node === null) {
    return false;
  }
  const total = Object.keys(owner.branchResults).length === node.branches.length;
  if (!total || owner.selected === null || context.draft.regionCancellations.has(owner.key)) {
    return true;
  }
  const completed = owner;
  context.draft.deleteFrame(owner.key);
  const cleanup = context.cleanupFor(owner.key);
  if (cleanup !== null && (cleanup.ownerKeys.length > 0 || cleanup.run)) {
    const cancelled = Object.freeze({ status: 'cancelled' as const });
    return (
      storeOwnedResult(context, owner.parentFrameKey, node.id, cancelledNode()) &&
      context.completeRequested(owner.parentFrameKey, cancelled, cleanup)
    );
  }
  if (completed.selected === 'cancelled') {
    return false;
  }
  return routeOwnedResult(
    context,
    owner.parentFrameKey,
    node.id,
    succeededNode(outputFor(completed)),
    node.next,
  );
};
