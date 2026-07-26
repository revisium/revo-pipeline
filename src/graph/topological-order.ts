import type { GraphKernel } from './graph-kernel.js';
import type { GraphOperationSink } from './graph-operation-sink.js';

const count = (sink: GraphOperationSink | undefined, kind: 'node' | 'edge' | 'readyWord'): void => {
  sink?.add(kind, 1);
};

const readyOffset = (
  ready: Uint32Array,
  sink: GraphOperationSink | undefined,
): number | undefined => {
  for (let wordOffset = 0; wordOffset < ready.length; wordOffset += 1) {
    count(sink, 'readyWord');
    const word = ready[wordOffset] ?? 0;
    if (word !== 0) {
      return wordOffset * 32 + (31 - Math.clz32(word & -word));
    }
  }
  return undefined;
};

const markReady = (
  ready: Uint32Array,
  offset: number,
  sink: GraphOperationSink | undefined,
): void => {
  const wordOffset = Math.floor(offset / 32);
  const bit = 1 << (offset % 32);
  count(sink, 'readyWord');
  ready[wordOffset] = (ready[wordOffset] ?? 0) | bit;
};

const clearReady = (
  ready: Uint32Array,
  offset: number,
  sink: GraphOperationSink | undefined,
): void => {
  const wordOffset = Math.floor(offset / 32);
  const bit = 1 << (offset % 32);
  count(sink, 'readyWord');
  ready[wordOffset] = (ready[wordOffset] ?? 0) & ~bit;
};

export const topologicalOrder = (
  kernel: GraphKernel,
  instrumentation?: GraphOperationSink,
): readonly number[] | null => {
  const indegree = kernel.incomingEdgeOffsets.map((edges) => edges.length);
  const ready = new Uint32Array(Math.ceil(kernel.nodeKeys.length / 32));
  for (let offset = 0; offset < indegree.length; offset += 1) {
    count(instrumentation, 'node');
    if (indegree[offset] === 0) {
      markReady(ready, offset, instrumentation);
    }
  }
  const order: number[] = [];
  while (true) {
    const offset = readyOffset(ready, instrumentation);
    if (offset === undefined) {
      break;
    }
    clearReady(ready, offset, instrumentation);
    count(instrumentation, 'node');
    order.push(offset);
    for (const edgeOffset of kernel.outgoingEdgeOffsets[offset] ?? []) {
      count(instrumentation, 'edge');
      const target = kernel.edgeToOffsets[edgeOffset];
      if (target === undefined) {
        continue;
      }
      const remaining = (indegree[target] ?? 0) - 1;
      indegree[target] = remaining;
      if (remaining === 0) {
        markReady(ready, target, instrumentation);
      }
    }
  }
  return order.length === kernel.nodeKeys.length ? Object.freeze(order) : null;
};
