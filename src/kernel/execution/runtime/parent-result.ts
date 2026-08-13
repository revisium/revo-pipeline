import type { Digest } from '../../../foundation/index.js';
import type { NodeTerminalResult } from '../../contracts/results.js';
import {
  recordNodeResult,
  recordPendingNodeResult,
  storePendingNodeResult,
} from '../region-state.js';
import type { RuntimeContext } from './context.js';

export const routeImmediateResult = (
  context: RuntimeContext,
  parentKey: Digest,
  nodeId: Digest,
  result: NodeTerminalResult,
  target: Digest,
): boolean => {
  const parent = context.draft.frames.get(parentKey);
  if (parent === undefined || !('ready' in parent)) {
    return false;
  }
  const updated = recordNodeResult(parent, nodeId, result, target);
  if (updated === null) {
    return false;
  }
  context.draft.setFrame(updated);
  context.draft.charge();
  context.enqueue(updated.key);
  return true;
};

export const routeOwnedResult = (
  context: RuntimeContext,
  parentKey: Digest,
  nodeId: Digest,
  result: NodeTerminalResult,
  target: Digest,
): boolean => {
  const parent = context.draft.frames.get(parentKey);
  if (parent === undefined || !('ready' in parent)) {
    return false;
  }
  const updated = recordPendingNodeResult(parent, nodeId, result, target);
  if (updated === null) {
    return false;
  }
  context.draft.setFrame(updated);
  context.draft.charge(2);
  context.enqueue(updated.key);
  return true;
};

export const storeOwnedResult = (
  context: RuntimeContext,
  parentKey: Digest,
  nodeId: Digest,
  result: NodeTerminalResult,
): boolean => {
  const parent = context.draft.frames.get(parentKey);
  if (parent === undefined || !('ready' in parent)) {
    return false;
  }
  const updated = storePendingNodeResult(parent, nodeId, result);
  if (updated === null) {
    return false;
  }
  context.draft.setFrame(updated);
  context.draft.charge(2);
  return true;
};
