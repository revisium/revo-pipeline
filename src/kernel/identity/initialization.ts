import { isDigest, type Digest } from '../../foundation/index.js';
import { computeFrameKey } from './digests.js';

const NULL_INITIALIZATION_FRAME_KEY: Digest =
  'sha256:b15ff8e8f9172a2ecc0ffe97cbc63ac3198f16a8e47baae28e1b09a5b9ca1086';

export type InitializationIdentity = {
  readonly candidateProgramDigest: Digest | null;
  readonly effectiveProgramDigest: Digest;
  readonly frameKey: Digest;
};

const readOwnValue = (input: unknown, key: string): unknown => {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
};

export const readCandidateProgramDigest = (input: unknown): Digest | null => {
  const candidate = readOwnValue(input, 'programDigest');
  return isDigest(candidate) ? candidate : null;
};

export const createInitializationIdentity = (
  candidateProgramDigest: Digest | null,
): InitializationIdentity => {
  const frameKey =
    computeFrameKey({
      kind: 'initialization',
      parentFrameKey: null,
      programDigest: candidateProgramDigest,
    }) ?? NULL_INITIALIZATION_FRAME_KEY;
  const effectiveProgramDigest = candidateProgramDigest ?? frameKey;
  return Object.freeze({
    candidateProgramDigest,
    effectiveProgramDigest,
    frameKey,
  });
};
