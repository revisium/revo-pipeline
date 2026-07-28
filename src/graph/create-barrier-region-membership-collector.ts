import { barrierRegionBitset } from './barrier-region-bitset.js';
import type { BarrierRegionQuery } from './barrier-region-query.js';
import type { GraphKernel } from './graph-kernel.js';
import type { GraphOperationSink } from './graph-operation-sink.js';
import { traverseBarrierRegion } from './traverse-barrier-region.js';

type MembershipCollector = (
  kernel: GraphKernel,
  query: BarrierRegionQuery,
) => readonly Uint32Array[];

const sharedForwardRows = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[],
  words: number,
  sink: GraphOperationSink | undefined,
): readonly Uint32Array[] => {
  const forward = Array.from({ length: kernel.nodeKeys.length }, () => new Uint32Array(words));
  for (const offset of [...topologicalOffsets].reverse()) {
    const row = forward[offset];
    if (!row) {
      continue;
    }
    barrierRegionBitset.set(row, offset, sink);
    for (const edgeOffset of kernel.outgoingEdgeOffsets[offset] ?? []) {
      sink?.add('edge', 1);
      const target = kernel.edgeToOffsets[edgeOffset];
      const source = target === undefined ? undefined : forward[target];
      if (source) {
        barrierRegionBitset.merge(row, source, sink);
      }
    }
  }
  return forward;
};

const sharedReverseRows = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[],
  words: number,
  sink: GraphOperationSink | undefined,
): readonly Uint32Array[] => {
  const reverse = Array.from({ length: kernel.nodeKeys.length }, () => new Uint32Array(words));
  for (const offset of topologicalOffsets) {
    const row = reverse[offset];
    if (!row) {
      continue;
    }
    barrierRegionBitset.set(row, offset, sink);
    for (const edgeOffset of kernel.outgoingEdgeOffsets[offset] ?? []) {
      sink?.add('edge', 1);
      const targetOffset = kernel.edgeToOffsets[edgeOffset];
      const target = targetOffset === undefined ? undefined : reverse[targetOffset];
      if (target) {
        barrierRegionBitset.merge(target, row, sink);
      }
    }
  }
  return reverse;
};

const branchWords = (
  kernel: GraphKernel,
  query: BarrierRegionQuery,
  forward: readonly Uint32Array[],
  reverse: readonly Uint32Array[],
  sink: GraphOperationSink | undefined,
): readonly Uint32Array[] =>
  query.branches.map((branch) => {
    sink?.add('region', 1);
    const result = new Uint32Array(barrierRegionBitset.wordCount(kernel));
    const reachable = forward[branch.entryNodeOffset];
    const predecessors = reverse[branch.exitNodeOffset];
    for (let word = 0; word < result.length; word += 1) {
      sink?.add('bitsetWord', 1);
      result[word] = (reachable?.[word] ?? 0) & (predecessors?.[word] ?? 0);
    }
    return result;
  });

const fallbackBranchWords = (
  kernel: GraphKernel,
  query: BarrierRegionQuery,
  sink: GraphOperationSink | undefined,
): readonly Uint32Array[] =>
  query.branches.map((branch) => {
    sink?.add('region', 1);
    const forward = traverseBarrierRegion(
      kernel,
      branch.entryNodeOffset,
      query.barrierNodeOffset,
      false,
      sink,
    );
    const reverse = traverseBarrierRegion(
      kernel,
      branch.exitNodeOffset,
      query.barrierNodeOffset,
      true,
      sink,
    );
    const result = new Uint32Array(barrierRegionBitset.wordCount(kernel));
    for (let word = 0; word < result.length; word += 1) {
      sink?.add('bitsetWord', 1);
      result[word] = (forward[word] ?? 0) & (reverse[word] ?? 0);
    }
    return result;
  });

const isBarrierSafe = (query: BarrierRegionQuery, positions: Uint16Array): boolean => {
  const barrierPosition = positions[query.barrierNodeOffset];
  return (
    barrierPosition !== undefined &&
    query.branches.every((branch) => {
      const entryPosition = positions[branch.entryNodeOffset];
      const exitPosition = positions[branch.exitNodeOffset];
      return (
        entryPosition !== undefined &&
        exitPosition !== undefined &&
        entryPosition < barrierPosition &&
        exitPosition < barrierPosition
      );
    })
  );
};

export const createBarrierRegionMembershipCollector = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[] | null,
  sink: GraphOperationSink | undefined,
): MembershipCollector => {
  if (topologicalOffsets === null) {
    return (currentKernel, query) => fallbackBranchWords(currentKernel, query, sink);
  }
  const words = barrierRegionBitset.wordCount(kernel);
  const forward = sharedForwardRows(kernel, topologicalOffsets, words, sink);
  const reverse = sharedReverseRows(kernel, topologicalOffsets, words, sink);
  const positions = new Uint16Array(kernel.nodeKeys.length);
  for (let position = 0; position < topologicalOffsets.length; position += 1) {
    const offset = topologicalOffsets[position];
    if (offset !== undefined) {
      sink?.add('node', 1);
      positions[offset] = position;
    }
  }
  return (currentKernel, query) =>
    isBarrierSafe(query, positions)
      ? branchWords(currentKernel, query, forward, reverse, sink)
      : fallbackBranchWords(currentKernel, query, sink);
};
