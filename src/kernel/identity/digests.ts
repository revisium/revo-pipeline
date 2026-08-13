import {
  compareUnicodeCodePoints,
  computeDomainDigest,
  type Digest,
} from '../../foundation/index.js';
import type { PipelineCommand } from '../contracts/commands.js';
import type { PipelineEvent } from '../contracts/events.js';
import type { CommandKey, CommandRef, FrameKeyPayload } from '../contracts/identity.js';

const digest = (domain: 'pipeline-frame-key/v1' | 'pipeline-command-key/v1', value: unknown) => {
  const result = computeDomainDigest(domain, value);
  return result.ok ? result.digest : null;
};

export const computeFrameKey = (payload: FrameKeyPayload): Digest | null =>
  digest('pipeline-frame-key/v1', payload);

export const computeCommandKey = (
  kind: PipelineCommand['kind'],
  ref: CommandRef,
): CommandKey | null => digest('pipeline-command-key/v1', { kind, ref });

export const computeEventDigest = (event: PipelineEvent): Digest | null => {
  const result = computeDomainDigest('pipeline-event/v1', event);
  return result.ok ? result.digest : null;
};

const commandPriority = Object.freeze({
  cancelPending: 0,
  dispatchActivity: 10,
  scheduleWait: 20,
  openHumanGate: 30,
  complete: 90,
  fail: 91,
  cancel: 92,
} satisfies Readonly<Record<PipelineCommand['kind'], number>>);

const compareCommandRefs = (left: CommandRef, right: CommandRef): number => {
  const frameKey = compareUnicodeCodePoints(left.frameKey, right.frameKey);
  if (frameKey !== 0) {
    return frameKey;
  }
  const nodeId = compareUnicodeCodePoints(left.nodeId, right.nodeId);
  return nodeId === 0 ? compareUnicodeCodePoints(left.programDigest, right.programDigest) : nodeId;
};

export const compareCommands = (left: PipelineCommand, right: PipelineCommand): number => {
  const priority = commandPriority[left.kind] - commandPriority[right.kind];
  if (priority !== 0) {
    return priority;
  }
  const refOrder = compareCommandRefs(left.ref, right.ref);
  return refOrder === 0 ? compareUnicodeCodePoints(left.key, right.key) : refOrder;
};

export const canonicalCommands = (commands: readonly PipelineCommand[]) =>
  Object.freeze([...commands].sort(compareCommands));
