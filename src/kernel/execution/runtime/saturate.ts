import type { Digest } from '../../../foundation/index.js';
import type { ProgramNode } from '../../../program/index.js';
import type { RegionMachineFrame } from '../../contracts/region-frames.js';
import type { RuntimeContext } from './context.js';
import { selectorEnvironmentFor } from './environment.js';
import { settleMapOwner } from './map-completion.js';
import { settleParallelOwner } from './parallel-completion.js';
import { findRuntimeNode, resolveRuntimeRegion } from './program-index.js';
import { completeRegion } from './region-completion.js';
import {
  selectChoiceNode,
  startActivityNode,
  startCallNode,
  startHumanGateNode,
  startWaitNode,
} from './start-direct.js';
import { startMap } from './start-map.js';
import { startParallel } from './start-parallel.js';
import { startRepeat } from './start-repeat.js';

const isRegionFrame = (value: unknown): value is RegionMachineFrame =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  (value.kind === 'rootRegion' ||
    value.kind === 'callRegion' ||
    value.kind === 'parallelBranch' ||
    value.kind === 'repeatBody' ||
    value.kind === 'mapItem');

const executeNode = (
  context: RuntimeContext,
  frame: RegionMachineFrame,
  node: ProgramNode,
): boolean => {
  const region = resolveRuntimeRegion(frame.key, context.draft, context.index);
  const environment = region === null ? null : selectorEnvironmentFor(region, context);
  if (region === null || environment === null) {
    return false;
  }
  switch (node.kind) {
    case 'activity':
      return startActivityNode(context, frame.key, node, environment);
    case 'choice':
      return selectChoiceNode(context, frame.key, node, environment);
    case 'call':
      return startCallNode(context, frame.key, node, environment);
    case 'parallel':
      return startParallel(context, frame.key, node, environment);
    case 'repeat':
      return startRepeat(context, frame.key, node, environment);
    case 'map':
      return startMap(context, frame.key, node, environment);
    case 'wait':
      return startWaitNode(context, frame.key, node);
    case 'humanGate':
      return startHumanGateNode(context, frame.key, node);
    case 'end':
      return completeRegion(context, frame, node);
  }
  node satisfies never;
  return false;
};

const executeFrame = (context: RuntimeContext, frameKey: Digest): boolean => {
  const frame = context.draft.frames.get(frameKey);
  if (context.draft.getRunCancellation() !== null) {
    return frame !== undefined;
  }
  if (frame?.kind === 'parallel') {
    return settleParallelOwner(context, frame);
  }
  if (frame?.kind === 'map') {
    return settleMapOwner(context, frame);
  }
  if (!isRegionFrame(frame) || frame.ready.length === 0) {
    return frame !== undefined;
  }
  const region = resolveRuntimeRegion(frame.key, context.draft, context.index);
  const node =
    region === null ? null : findRuntimeNode(context.index, region.region, frame.ready[0] ?? '');
  return node !== null && context.draft.charge() && executeNode(context, frame, node);
};

export const drainRuntimeQueue = (
  context: RuntimeContext,
  take: () => Digest | undefined,
): void => {
  while (context.isValid() && context.terminal() === null) {
    const key = take();
    if (key === undefined) {
      break;
    }
    if (!executeFrame(context, key)) {
      context.invalidate();
    }
  }
};
