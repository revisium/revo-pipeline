import type { ProgramMapNode } from '../../../program/index.js';
import { consumeRegionNode } from '../region-state.js';
import type { SelectorEnvironment } from '../selectors.js';
import type { RuntimeContext } from './context.js';
import type { MapItemDescriptor } from './map-preflight.js';
import { preflightMap } from './map-preflight.js';
import { createMapOwner } from './owner-frames.js';
import { routeImmediateResult } from './parent-result.js';
import { createMapItemFrame } from './region-frames.js';
import { failedNode } from './results.js';

const startItems = (
  context: RuntimeContext,
  node: ProgramMapNode,
  descriptors: readonly MapItemDescriptor[],
  owner: NonNullable<ReturnType<typeof createMapOwner>>,
): boolean => {
  const starting = descriptors.slice(0, node.maximumConcurrency);
  const keys: string[] = [];
  for (const descriptor of starting) {
    const item = createMapItemFrame(owner.key, descriptor.itemKey, node.body, descriptor.input);
    if (item === null || !context.draft.addFrame(item)) {
      return false;
    }
    keys.push(descriptor.itemKey);
    context.enqueue(item.key);
  }
  context.draft.setFrame(
    Object.freeze({
      ...owner,
      pendingItemKeys: Object.freeze(
        descriptors.slice(starting.length).map(({ itemKey }) => itemKey),
      ),
      activeItemKeys: Object.freeze(keys),
    }),
  );
  return true;
};

export const startMap = (
  context: RuntimeContext,
  parentKey: Parameters<typeof createMapOwner>[0],
  node: ProgramMapNode,
  environment: SelectorEnvironment,
): boolean => {
  const preflight = preflightMap(node, environment);
  if (!preflight.ok) {
    return routeImmediateResult(
      context,
      parentKey,
      node.id,
      failedNode(preflight.failure),
      node.routes.failed,
    );
  }
  const parent = context.draft.frames.get(parentKey);
  if (parent === undefined || !('ready' in parent)) {
    return false;
  }
  const consumed = consumeRegionNode(parent, node.id);
  const owner = createMapOwner(parent.key, parent.scopeInput, node, preflight.descriptors);
  if (consumed === null || owner === null) {
    return false;
  }
  context.draft.setFrame(consumed);
  if (!context.draft.addFrame(owner)) {
    return false;
  }
  context.draft.mapPreflights.remember(owner.key, preflight);
  if (preflight.descriptors.length === 0) {
    context.draft.setFrame(Object.freeze({ ...owner, status: 'completed', selected: 'completed' }));
    context.enqueue(owner.key);
    return true;
  }
  return startItems(context, node, preflight.descriptors, owner);
};
