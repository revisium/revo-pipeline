import type { GraphKernel } from '../../graph/index.js';
import type { CompiledPipeline } from '../../spec/index.js';

const edgeIndexMatches = (
  snapshot: Readonly<CompiledPipeline>,
  kernel: GraphKernel,
  direction: 'incoming' | 'outgoing',
): boolean => {
  const serialized = direction === 'incoming' ? snapshot.incomingIndex : snapshot.outgoingIndex;
  const expected =
    direction === 'incoming' ? kernel.incomingEdgeOffsets : kernel.outgoingEdgeOffsets;
  return (
    serialized.length === kernel.nodeKeys.length &&
    serialized.every((entry, nodeOffset) => {
      const expectedOffsets = expected?.[nodeOffset];
      return (
        entry.key === kernel.nodeKeys[nodeOffset] &&
        entry.edges.length === expectedOffsets?.length &&
        entry.edges.every(
          (edgeOffset, indexOffset) => edgeOffset === expectedOffsets?.[indexOffset],
        )
      );
    })
  );
};

export const verifySerializedIndexes = (
  snapshot: Readonly<CompiledPipeline>,
  kernel: GraphKernel,
): boolean =>
  snapshot.nodeIndex.length === kernel.nodeKeys.length &&
  snapshot.nodeIndex.every(
    (entry, nodeOffset) => entry.key === kernel.nodeKeys[nodeOffset] && entry.node === nodeOffset,
  ) &&
  edgeIndexMatches(snapshot, kernel, 'incoming') &&
  edgeIndexMatches(snapshot, kernel, 'outgoing');
