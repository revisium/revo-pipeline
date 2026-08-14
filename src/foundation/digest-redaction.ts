import type { Digest } from './digest.js';

const invalidDigestInput = (): never => {
  throw new TypeError('Invalid pipeline digest input.');
};

export const computeRedactedDigest = (compute: () => Digest | null): Digest => {
  try {
    return compute() ?? invalidDigestInput();
  } catch {
    return invalidDigestInput();
  }
};
