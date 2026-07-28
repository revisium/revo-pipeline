import type { BarrierRegionOwnership } from './barrier-region-ownership.js';
import type { BarrierRegionQuery } from './barrier-region-query.js';
import { classifyBarrierRegionOwnership } from './classify-barrier-region-ownership.js';
import { createBarrierRegionMembershipCollector } from './create-barrier-region-membership-collector.js';
import type { GraphKernel } from './graph-kernel.js';
import type { GraphOperationSink } from './graph-operation-sink.js';
import { isTopologicalOrder } from './is-topological-order.js';
import { validateBarrierRegionQueries } from './validate-barrier-region-queries.js';

export const collectBarrierRegionOwnership = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[] | null,
  queries: readonly BarrierRegionQuery[],
  instrumentation?: GraphOperationSink,
): readonly BarrierRegionOwnership[] => {
  if (!validateBarrierRegionQueries(kernel, queries) || queries.length === 0) {
    return Object.freeze([]);
  }
  const validTopology =
    topologicalOffsets !== null && isTopologicalOrder(kernel, topologicalOffsets, instrumentation)
      ? topologicalOffsets
      : null;
  const collectMembership = createBarrierRegionMembershipCollector(
    kernel,
    validTopology,
    instrumentation,
  );
  const priorOwners = new Set<number>();
  return Object.freeze(
    queries.map((query) =>
      classifyBarrierRegionOwnership(
        kernel,
        query.barrierNodeOffset,
        collectMembership(kernel, query),
        priorOwners,
        instrumentation,
      ),
    ),
  );
};
