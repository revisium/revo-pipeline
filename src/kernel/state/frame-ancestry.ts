import type { Digest } from '../../foundation/index.js';
import type { MachineFrame } from '../contracts/frames.js';

export const walkFrameAncestry = (
  frames: ReadonlyMap<Digest, MachineFrame>,
  startKey: Digest,
  visit: (frame: MachineFrame) => boolean,
): boolean => {
  const visited = new Set<Digest>();
  let currentKey: Digest | null = startKey;
  while (currentKey !== null) {
    const current = frames.get(currentKey);
    if (current === undefined) {
      return false;
    }
    if (visited.has(current.key)) {
      return false;
    }
    visited.add(current.key);
    if (!visit(current)) {
      return true;
    }
    currentKey = current.parentFrameKey;
  }
  return true;
};
