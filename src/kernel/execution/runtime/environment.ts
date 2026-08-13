import type { RegionMachineFrame } from '../../contracts/region-frames.js';
import type { SelectorEnvironment } from '../selectors.js';
import type { RuntimeContext } from './context.js';
import { reconstructMapItem, resolveMapItems, sourceIndexFor } from './map-reconstruction.js';
import {
  findRuntimeNode,
  resolveRuntimeRegion,
  type RuntimeRegionContext,
} from './program-index.js';

const parentRegionFrame = (
  frame: RegionMachineFrame,
  context: RuntimeContext,
): RegionMachineFrame | null => {
  const owner =
    frame.parentFrameKey === null ? undefined : context.draft.frames.get(frame.parentFrameKey);
  const parentFrameKey = owner?.parentFrameKey;
  if (parentFrameKey === undefined || parentFrameKey === null) {
    return null;
  }
  const parent = context.draft.frames.get(parentFrameKey);
  return parent !== undefined &&
    (parent.kind === 'rootRegion' ||
      parent.kind === 'callRegion' ||
      parent.kind === 'parallelBranch' ||
      parent.kind === 'repeatBody' ||
      parent.kind === 'mapItem')
    ? parent
    : null;
};

const baseEnvironment = (region: RuntimeRegionContext): SelectorEnvironment => ({
  moduleInput: region.moduleInput,
  scopeInput: region.frame.scopeInput,
  nodeResults: region.frame.nodeResults,
});

const enclosingEnvironment = (
  frame: RegionMachineFrame,
  context: RuntimeContext,
): SelectorEnvironment | null => {
  const parent = parentRegionFrame(frame, context);
  if (parent === null) {
    return null;
  }
  const region = resolveRuntimeRegion(parent.key, context.draft, context.index);
  return region === null ? null : selectorEnvironmentFor(region, context);
};

export const selectorEnvironmentFor = (
  region: RuntimeRegionContext,
  context: RuntimeContext,
): SelectorEnvironment | null => {
  const environment = baseEnvironment(region);
  const { frame } = region;
  if (frame.kind === 'repeatBody') {
    const owner = context.draft.frames.get(frame.parentFrameKey);
    return owner?.kind === 'repeat'
      ? {
          ...environment,
          repeat: {
            iteration: frame.ordinal,
            previousOutput: owner.previousOutput,
          },
        }
      : null;
  }
  if (frame.kind !== 'mapItem') {
    return environment;
  }
  const owner = context.draft.frames.get(frame.parentFrameKey);
  const parentEnvironment = enclosingEnvironment(frame, context);
  const parent = parentRegionFrame(frame, context);
  const parentOwner =
    parent === null ? null : resolveRuntimeRegion(parent.key, context.draft, context.index);
  const node =
    owner?.kind === 'map' && parentOwner !== null
      ? findRuntimeNode(context.index, parentOwner.region, owner.nodeId)
      : null;
  if (owner?.kind !== 'map' || node?.kind !== 'map' || parentEnvironment === null) {
    return null;
  }
  const items = resolveMapItems(node, parentEnvironment, owner.itemKeys.length);
  if (items === null) {
    return null;
  }
  const descriptor = context.draft.mapPreflights.descriptor(
    owner.key,
    frame.itemKey,
    (counters) => {
      const sourceIndex = sourceIndexFor(owner, frame.itemKey, counters);
      return sourceIndex === null
        ? null
        : reconstructMapItem(node, parentEnvironment, items, frame.itemKey, sourceIndex, counters);
    },
  );
  return descriptor === null
    ? null
    : { ...environment, map: { item: descriptor.item, itemKey: descriptor.itemKey } };
};
