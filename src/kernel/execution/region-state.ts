import { compareUnicodeCodePoints, type Digest } from '../../foundation/index.js';
import type { RegionMachineFrame } from '../contracts/region-frames.js';
import type { NodeTerminalResult } from '../contracts/results.js';
import { insertCanonicalNodeResult } from '../state/node-results.js';

export const consumeRegionNode = (
  frame: RegionMachineFrame,
  nodeId: Digest,
  target?: Digest,
): RegionMachineFrame | null => {
  if (!frame.ready.includes(nodeId)) {
    return null;
  }
  const ready: Digest[] = frame.ready.filter((value: Digest) => value !== nodeId);
  if (target !== undefined && !ready.includes(target)) {
    ready.push(target);
  }
  ready.sort(compareUnicodeCodePoints);
  return Object.freeze({ ...frame, ready: Object.freeze(ready) });
};

export const recordNodeResult = (
  frame: RegionMachineFrame,
  nodeId: Digest,
  result: NodeTerminalResult,
  target: Digest,
): RegionMachineFrame | null => {
  if (Object.hasOwn(frame.nodeResults, nodeId)) {
    return null;
  }
  const advanced = consumeRegionNode(frame, nodeId, target);
  const nodeResults = insertCanonicalNodeResult(frame.nodeResults, nodeId, result);
  return advanced === null || nodeResults === null
    ? null
    : Object.freeze({
        ...advanced,
        nodeResults,
      });
};

export const recordPendingNodeResult = (
  frame: RegionMachineFrame,
  nodeId: Digest,
  result: NodeTerminalResult,
  target: Digest,
): RegionMachineFrame | null => {
  if (Object.hasOwn(frame.nodeResults, nodeId) || frame.ready.includes(nodeId)) {
    return null;
  }
  const ready = frame.ready.includes(target)
    ? frame.ready
    : Object.freeze([...frame.ready, target].sort(compareUnicodeCodePoints));
  const nodeResults = insertCanonicalNodeResult(frame.nodeResults, nodeId, result);
  return nodeResults === null
    ? null
    : Object.freeze({
        ...frame,
        ready,
        nodeResults,
      });
};

export const storePendingNodeResult = (
  frame: RegionMachineFrame,
  nodeId: Digest,
  result: NodeTerminalResult,
): RegionMachineFrame | null => {
  if (Object.hasOwn(frame.nodeResults, nodeId) || frame.ready.includes(nodeId)) {
    return null;
  }
  const nodeResults = insertCanonicalNodeResult(frame.nodeResults, nodeId, result);
  return nodeResults === null ? null : Object.freeze({ ...frame, nodeResults });
};
