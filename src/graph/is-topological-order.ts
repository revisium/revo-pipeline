import type { GraphKernel } from './graph-kernel.js';
import type { GraphOperationSink } from './graph-operation-sink.js';

export const isTopologicalOrder = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[],
  sink: GraphOperationSink | undefined,
): boolean => {
  if (topologicalOffsets.length !== kernel.nodeKeys.length) {
    return false;
  }
  const positions = new Int16Array(kernel.nodeKeys.length);
  positions.fill(-1);
  for (let position = 0; position < topologicalOffsets.length; position += 1) {
    sink?.add('node', 1);
    const offset = topologicalOffsets[position];
    if (
      offset === undefined ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= kernel.nodeKeys.length ||
      positions[offset] !== -1
    ) {
      return false;
    }
    positions[offset] = position;
  }
  for (let edgeOffset = 0; edgeOffset < kernel.edgeFromOffsets.length; edgeOffset += 1) {
    sink?.add('edge', 1);
    const from = kernel.edgeFromOffsets[edgeOffset];
    const to = kernel.edgeToOffsets[edgeOffset];
    if (
      from === undefined ||
      to === undefined ||
      (positions[from] ?? -1) >= (positions[to] ?? -1)
    ) {
      return false;
    }
  }
  return true;
};
