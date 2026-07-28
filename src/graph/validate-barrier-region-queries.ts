import type { BarrierRegionQuery } from './barrier-region-query.js';
import type { GraphKernel } from './graph-kernel.js';

export const validateBarrierRegionQueries = (
  kernel: GraphKernel,
  queries: readonly BarrierRegionQuery[],
): boolean => {
  if (queries.length > kernel.nodeKeys.length || queries.length > 256) {
    return false;
  }
  let total = 0;
  for (const query of queries) {
    if (
      query.barrierNodeOffset < 0 ||
      query.barrierNodeOffset >= kernel.nodeKeys.length ||
      query.branches.length > 32
    ) {
      return false;
    }
    total += query.branches.length;
    if (!Number.isSafeInteger(total) || total > 32 * kernel.nodeKeys.length || total > 8192) {
      return false;
    }
    if (
      query.branches.some(
        (branch) =>
          branch.entryNodeOffset < 0 ||
          branch.entryNodeOffset >= kernel.nodeKeys.length ||
          branch.exitNodeOffset < 0 ||
          branch.exitNodeOffset >= kernel.nodeKeys.length,
      )
    ) {
      return false;
    }
  }
  return true;
};
