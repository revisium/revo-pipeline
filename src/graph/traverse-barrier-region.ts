import { barrierRegionBitset } from './barrier-region-bitset.js';
import type { GraphKernel } from './graph-kernel.js';
import type { GraphOperationSink } from './graph-operation-sink.js';

export const traverseBarrierRegion = (
  kernel: GraphKernel,
  start: number,
  barrier: number,
  reverse: boolean,
  sink: GraphOperationSink | undefined,
): Uint32Array => {
  const visited = new Uint32Array(barrierRegionBitset.wordCount(kernel));
  const pending = [start];
  while (pending.length > 0) {
    const offset = pending.pop();
    if (
      offset === undefined ||
      offset === barrier ||
      barrierRegionBitset.has(visited, offset, sink)
    ) {
      continue;
    }
    barrierRegionBitset.set(visited, offset, sink);
    sink?.add('node', 1);
    const edges = reverse
      ? (kernel.incomingEdgeOffsets[offset] ?? [])
      : (kernel.outgoingEdgeOffsets[offset] ?? []);
    for (const edgeOffset of edges) {
      sink?.add('edge', 1);
      const next = reverse ? kernel.edgeFromOffsets[edgeOffset] : kernel.edgeToOffsets[edgeOffset];
      if (next !== undefined) {
        pending.push(next);
      }
    }
  }
  return visited;
};
