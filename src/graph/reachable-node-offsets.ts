import type { GraphKernel } from './graph-kernel.js';
import type { GraphOperationSink } from './graph-operation-sink.js';

const visitedOffset = (
  visited: Uint32Array,
  offset: number,
  sink: GraphOperationSink | undefined,
): boolean => {
  const wordOffset = Math.floor(offset / 32);
  const bit = 1 << (offset % 32);
  sink?.add('bitsetWord', 1);
  if (((visited[wordOffset] ?? 0) & bit) !== 0) {
    return true;
  }
  sink?.add('bitsetWord', 1);
  visited[wordOffset] = (visited[wordOffset] ?? 0) | bit;
  return false;
};

export const reachableNodeOffsets = (
  kernel: GraphKernel,
  starts: readonly number[],
  instrumentation?: GraphOperationSink,
): readonly boolean[] => {
  const visited = new Uint32Array(Math.ceil(kernel.nodeKeys.length / 32));
  const reached = Array.from({ length: kernel.nodeKeys.length }, () => false);
  const pending = [...starts];
  while (pending.length > 0) {
    const offset = pending.pop();
    if (
      offset === undefined ||
      offset < 0 ||
      offset >= kernel.nodeKeys.length ||
      visitedOffset(visited, offset, instrumentation)
    ) {
      continue;
    }
    instrumentation?.add('node', 1);
    reached[offset] = true;
    for (const edgeOffset of kernel.outgoingEdgeOffsets[offset] ?? []) {
      instrumentation?.add('edge', 1);
      const target = kernel.edgeToOffsets[edgeOffset];
      if (target !== undefined) {
        pending.push(target);
      }
    }
  }
  const result = reached.map((value) => {
    instrumentation?.add('node', 1);
    return value;
  });
  return Object.freeze(result);
};
