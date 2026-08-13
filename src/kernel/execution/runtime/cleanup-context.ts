import type { Digest } from '../../../foundation/index.js';
import type { RequestedCleanup } from './context.js';

export const consumeCleanupOwner = (
  cleanup: RequestedCleanup,
  ownerKey: Digest,
): { readonly captured: boolean; readonly remaining: RequestedCleanup } => {
  const captured = cleanup.ownerKeys[0] === ownerKey;
  return Object.freeze({
    captured,
    remaining: captured
      ? Object.freeze({ ...cleanup, ownerKeys: Object.freeze(cleanup.ownerKeys.slice(1)) })
      : cleanup,
  });
};
