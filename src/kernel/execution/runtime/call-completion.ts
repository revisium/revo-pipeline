import type { ProgramCallNode } from '../../../program/index.js';
import type { CallRegionMachineFrame } from '../../contracts/region-frames.js';
import type { RegionTerminalResult } from '../../contracts/results.js';
import { valueMatchesSchema } from '../selectors.js';
import { pruneFrameTree } from './cancellation.js';
import type { CancellationCausality, RuntimeContext } from './context.js';
import { routeOwnedResult } from './parent-result.js';
import { storeOwnedResult } from './parent-result.js';
import { findRuntimeNode, resolveRuntimeRegion } from './program-index.js';
import { cancelledNode, cleanupNodeResult, failedNode, failure, succeededNode } from './results.js';

const callNode = (
  context: RuntimeContext,
  parentFrameKey: CallRegionMachineFrame['parentFrameKey'],
): {
  readonly owner: Extract<Parameters<RuntimeContext['draft']['setFrame']>[0], { kind: 'call' }>;
  readonly node: ProgramCallNode;
} | null => {
  const owner = context.draft.frames.get(parentFrameKey);
  const region =
    owner?.kind === 'call'
      ? resolveRuntimeRegion(owner.parentFrameKey, context.draft, context.index)
      : null;
  const node =
    owner?.kind === 'call' && region !== null
      ? findRuntimeNode(context.index, region.region, owner.nodeId)
      : null;
  return owner?.kind === 'call' && node?.kind === 'call' ? Object.freeze({ owner, node }) : null;
};

export const completeCallRegion = (
  context: RuntimeContext,
  frame: CallRegionMachineFrame,
  result: RegionTerminalResult,
  causality: CancellationCausality | null = null,
): boolean => {
  const completion = callNode(context, frame.parentFrameKey);
  if (completion === null || !pruneFrameTree(context.draft, frame.key)) {
    return false;
  }
  const { owner, node } = completion;
  context.draft.deleteFrame(owner.key);
  if (causality !== null && causality !== 'isolated') {
    const stored = storeOwnedResult(
      context,
      owner.parentFrameKey,
      node.id,
      cleanupNodeResult(result),
    );
    return stored && context.completeRequested(owner.parentFrameKey, result, causality);
  }
  if (result.status === 'failed') {
    return routeOwnedResult(
      context,
      owner.parentFrameKey,
      node.id,
      failedNode(result.failure),
      node.routes.failed,
    );
  }
  if (result.status === 'cancelled') {
    return routeOwnedResult(
      context,
      owner.parentFrameKey,
      node.id,
      cancelledNode(),
      node.routes.cancelled,
    );
  }
  const route = node.routes.outcomes.find(({ outcome }) => outcome === result.outcome);
  if (route === undefined || !valueMatchesSchema(node.outputSchema, result.output)) {
    return routeOwnedResult(
      context,
      owner.parentFrameKey,
      node.id,
      failedNode(failure('DATA_SCHEMA_MISMATCH')),
      node.routes.failed,
    );
  }
  return routeOwnedResult(
    context,
    owner.parentFrameKey,
    node.id,
    succeededNode(result.output),
    route.target,
  );
};
