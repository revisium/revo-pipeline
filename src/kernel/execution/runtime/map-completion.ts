import { compareUnicodeCodePoints } from '../../../foundation/index.js';
import type { ProgramMapNode } from '../../../program/index.js';
import type { MapItemMachineFrame } from '../../contracts/region-frames.js';
import type { RegionTerminalResult } from '../../contracts/results.js';
import type { MapItemResult, MapMachineFrame } from '../../contracts/structured-frames.js';
import {
  pendingAncestorKeys,
  pruneFrameTree,
  pruneFrameTrees,
  requestRegionCancellation,
} from './cancellation.js';
import { consumeCleanupOwner } from './cleanup-context.js';
import type { CancellationCausality, RuntimeContext } from './context.js';
import { selectorEnvironmentFor } from './environment.js';
import { reconstructMapItem, resolveMapItems, sourceIndexFor } from './map-reconstruction.js';
import {
  findSelectedMapFailure,
  insertMapItemResult,
  projectMapItems,
  toMapItemResult,
} from './map-results.js';
import { routeOwnedResult, storeOwnedResult } from './parent-result.js';
import { findRuntimeNode, resolveRuntimeRegion } from './program-index.js';
import { createMapItemFrame } from './region-frames.js';
import { cancelledNode, failedNode, regionFailure, succeededNode } from './results.js';

const ownerNode = (context: RuntimeContext, owner: MapMachineFrame): ProgramMapNode | null => {
  const region = resolveRuntimeRegion(owner.parentFrameKey, context.draft, context.index);
  const node = region === null ? null : findRuntimeNode(context.index, region.region, owner.nodeId);
  return node?.kind === 'map' ? node : null;
};

type MapCompletionState = Pick<MapMachineFrame, 'selected' | 'selectedFailureItemKey' | 'status'>;

const completionState = (
  owner: MapMachineFrame,
  node: ProgramMapNode,
  item: MapItemResult,
  itemKey: string,
  requested: boolean,
): MapCompletionState => {
  if (requested) {
    return Object.freeze({
      selected: owner.selected ?? 'cancelled',
      selectedFailureItemKey: owner.selectedFailureItemKey,
      status: 'draining',
    });
  }
  const selectFailure =
    owner.selected === null && item.status === 'failed' && node.failure.kind === 'failFast';
  if (!selectFailure) {
    return Object.freeze({
      selected: owner.selected,
      selectedFailureItemKey: owner.selectedFailureItemKey,
      status: owner.status,
    });
  }
  return Object.freeze({
    selected: 'failed',
    selectedFailureItemKey: itemKey,
    status: node.failure.remaining === 'cancel' ? 'cancelling' : 'draining',
  });
};

export const completeMapItem = (
  context: RuntimeContext,
  frame: MapItemMachineFrame,
  result: RegionTerminalResult,
  causality: CancellationCausality | null = null,
): boolean => {
  const owner = context.draft.frames.get(frame.parentFrameKey);
  if (owner?.kind !== 'map') {
    return false;
  }
  const node = ownerNode(context, owner);
  if (node === null || !pruneFrameTree(context.draft, frame.key)) {
    return false;
  }
  const item = toMapItemResult(node, frame.itemKey, result);
  const requested = causality !== null && causality !== 'isolated' ? causality : null;
  const cleanupOwner = requested === null ? null : consumeCleanupOwner(requested, owner.key);
  if (cleanupOwner?.captured === true && owner.selected === null) {
    return false;
  }
  const state = completionState(owner, node, item, frame.itemKey, requested !== null);
  const updated = Object.freeze({
    ...owner,
    activeItemKeys: Object.freeze(owner.activeItemKeys.filter((key) => key !== frame.itemKey)),
    completedItems: insertMapItemResult(owner.completedItems, item),
    ...state,
  });
  context.draft.setFrame(updated);
  if (cleanupOwner !== null) {
    context.markCleanup(owner.key, cleanupOwner.remaining);
  }
  context.draft.charge(2);
  context.enqueue(owner.key);
  return true;
};

const locallyCancelUnstarted = (owner: MapMachineFrame): MapMachineFrame => {
  const cancelled = owner.pendingItemKeys.map(
    (itemKey): MapItemResult =>
      Object.freeze({
        itemKey,
        status: 'cancelled',
        output: null,
        failure: null,
      }),
  );
  return Object.freeze({
    ...owner,
    pendingItemKeys: Object.freeze([]),
    completedItems: Object.freeze(
      [...owner.completedItems, ...cancelled].sort((left, right) =>
        compareUnicodeCodePoints(left.itemKey, right.itemKey),
      ),
    ),
  });
};

const locallyCancelIdleActive = (
  context: RuntimeContext,
  owner: MapMachineFrame,
): MapMachineFrame => {
  const cancelled: MapItemResult[] = [];
  const active: string[] = [];
  const frames = new Map(
    [...context.draft.frames.values()]
      .filter(
        (candidate): candidate is MapItemMachineFrame =>
          candidate.kind === 'mapItem' && candidate.parentFrameKey === owner.key,
      )
      .map((candidate) => [candidate.itemKey, candidate]),
  );
  const live = pendingAncestorKeys(context.draft);
  const idleRoots: MapItemMachineFrame[] = [];
  for (const itemKey of owner.activeItemKeys) {
    const frame = frames.get(itemKey);
    if (frame === undefined || live.has(frame.key)) {
      active.push(itemKey);
    } else {
      idleRoots.push(frame);
      cancelled.push(Object.freeze({ itemKey, status: 'cancelled', output: null, failure: null }));
    }
  }
  if (
    !pruneFrameTrees(
      context.draft,
      idleRoots.map(({ key }) => key),
      context.discard,
    )
  ) {
    return owner;
  }
  return Object.freeze({
    ...owner,
    activeItemKeys: Object.freeze(active),
    completedItems: Object.freeze(
      [...owner.completedItems, ...cancelled].sort((left, right) =>
        compareUnicodeCodePoints(left.itemKey, right.itemKey),
      ),
    ),
  });
};

const refill = (
  context: RuntimeContext,
  owner: MapMachineFrame,
  node: ProgramMapNode,
): MapMachineFrame | null => {
  const parent = resolveRuntimeRegion(owner.parentFrameKey, context.draft, context.index);
  const environment = parent === null ? null : selectorEnvironmentFor(parent, context);
  if (environment === null) {
    return null;
  }
  const items = resolveMapItems(node, environment, owner.itemKeys.length);
  if (items === null) {
    return null;
  }
  const capacity = Math.max(0, node.maximumConcurrency - owner.activeItemKeys.length);
  const startingKeys = owner.pendingItemKeys.slice(0, capacity);
  const active = [...owner.activeItemKeys];
  for (const itemKey of startingKeys) {
    const descriptor = context.draft.mapPreflights.descriptor(owner.key, itemKey, (counters) => {
      const sourceIndex = sourceIndexFor(owner, itemKey, counters);
      return sourceIndex === null
        ? null
        : reconstructMapItem(node, environment, items, itemKey, sourceIndex, counters);
    });
    const frame =
      descriptor === null
        ? null
        : createMapItemFrame(owner.key, itemKey, node.body, descriptor.input);
    if (frame === null || !context.draft.addFrame(frame)) {
      return null;
    }
    active.push(itemKey);
    context.enqueue(frame.key);
  }
  return Object.freeze({
    ...owner,
    pendingItemKeys: Object.freeze(owner.pendingItemKeys.slice(startingKeys.length)),
    activeItemKeys: Object.freeze(active.toSorted(compareUnicodeCodePoints)),
  });
};

const finishMap = (
  context: RuntimeContext,
  owner: MapMachineFrame,
  node: ProgramMapNode,
): boolean => {
  context.draft.deleteFrame(owner.key);
  const cleanup = context.cleanupFor(owner.key);
  if (cleanup !== null && (cleanup.ownerKeys.length > 0 || cleanup.run)) {
    const selected = owner.selected === 'failed' ? findSelectedMapFailure(owner) : null;
    const nodeResult = selected === null ? cancelledNode() : failedNode(selected);
    const regionResult =
      selected === null ? Object.freeze({ status: 'cancelled' as const }) : regionFailure(selected);
    return (
      storeOwnedResult(context, owner.parentFrameKey, node.id, nodeResult) &&
      context.completeRequested(owner.parentFrameKey, regionResult, cleanup)
    );
  }
  if (owner.selected === 'failed') {
    const selected = findSelectedMapFailure(owner);
    if (selected === null) {
      context.selectTerminal({
        kind: 'failed',
        failure: Object.freeze({ code: 'INVARIANT_PROGRAM_STATE', path: '' }),
      });
      return true;
    }
    return routeOwnedResult(
      context,
      owner.parentFrameKey,
      node.id,
      failedNode(selected),
      node.routes.failed,
    );
  }
  if (owner.selected === 'cancelled') {
    return false;
  }
  return routeOwnedResult(
    context,
    owner.parentFrameKey,
    node.id,
    succeededNode(Object.freeze({ items: projectMapItems(owner.completedItems) })),
    node.routes.completed,
  );
};

export const settleMapOwner = (context: RuntimeContext, current: MapMachineFrame): boolean => {
  const node = ownerNode(context, current);
  if (node === null) {
    return false;
  }
  let owner = current;
  if (owner.selected !== null) {
    owner = locallyCancelUnstarted(owner);
    if (owner.status === 'cancelling') {
      owner = locallyCancelIdleActive(context, owner);
      context.draft.setFrame(owner);
      if (!requestRegionCancellation(context.draft, owner, 'MAP_FAIL_FAST')) {
        return false;
      }
    }
  } else if (owner.pendingItemKeys.length > 0) {
    const refilled = refill(context, owner, node);
    if (refilled === null) {
      return false;
    }
    owner = refilled;
  }
  context.draft.setFrame(owner);
  const waiting =
    owner.activeItemKeys.length > 0 ||
    owner.pendingItemKeys.length > 0 ||
    context.draft.regionCancellations.has(owner.key);
  if (waiting) {
    return true;
  }
  if (owner.selected === null) {
    owner = Object.freeze({ ...owner, selected: 'completed', selectedFailureItemKey: null });
  }
  return finishMap(context, owner, node);
};
