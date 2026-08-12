import {
  canonicalizeOwnedValue,
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

const compareBytes = (left: Uint8Array, right: Uint8Array): number => {
  const commonLength = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < commonLength; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.byteLength - right.byteLength;
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

export const compareCommands = (left: PipelineCommand, right: PipelineCommand): number => {
  const priority = commandPriority[left.kind] - commandPriority[right.kind];
  if (priority !== 0) {
    return priority;
  }
  const refOrder = compareBytes(
    canonicalizeOwnedValue(left.ref).bytes,
    canonicalizeOwnedValue(right.ref).bytes,
  );
  return refOrder === 0 ? compareUnicodeCodePoints(left.key, right.key) : refOrder;
};

export const canonicalCommands = (commands: readonly PipelineCommand[]) =>
  Object.freeze([...commands].sort(compareCommands));
