import { barrierRegionBitset } from './barrier-region-bitset.js';
import type { BarrierRegionOwnership } from './barrier-region-ownership.js';
import type { GraphKernel } from './graph-kernel.js';
import type { GraphOperationSink } from './graph-operation-sink.js';

export const classifyBarrierRegionOwnership = (
  kernel: GraphKernel,
  barrier: number,
  branchWords: readonly Uint32Array[],
  priorOwners: Set<number>,
  sink: GraphOperationSink | undefined,
): BarrierRegionOwnership => {
  const localOwners = new Set<number>();
  const overlap = new Set<number>();
  const foreign = new Set<number>();
  const membersByBranch = branchWords.map((words) => {
    const members = barrierRegionBitset.offsets(words, kernel.nodeKeys.length, barrier, sink);
    for (const member of members) {
      sink?.add('region', 1);
      if (localOwners.has(member) && !overlap.has(member)) {
        sink?.add('region', 1);
        overlap.add(member);
      }
      if (priorOwners.has(member) && !foreign.has(member)) {
        sink?.add('region', 1);
        foreign.add(member);
      }
      localOwners.add(member);
    }
    return members;
  });
  for (const member of localOwners) {
    priorOwners.add(member);
  }
  return Object.freeze({
    membersByBranch: Object.freeze(membersByBranch),
    overlappingNodeOffsets: Object.freeze([...overlap].sort((left, right) => left - right)),
    foreignRegionNodeOffsets: Object.freeze([...foreign].sort((left, right) => left - right)),
  });
};
