import type { GraphKernel } from '../../graph/index.js';
import type { CompiledPipeline } from '../../spec/index.js';

const edgeIndexMismatch = (
  snapshot: Readonly<CompiledPipeline>,
  kernel: GraphKernel,
  direction: 'incoming' | 'outgoing',
): string | null => {
  const serialized = direction === 'incoming' ? snapshot.incomingIndex : snapshot.outgoingIndex;
  const expected =
    direction === 'incoming' ? kernel.incomingEdgeOffsets : kernel.outgoingEdgeOffsets;
  const root = direction === 'incoming' ? '/incomingIndex' : '/outgoingIndex';
  if (serialized.length !== kernel.nodeKeys.length) {
    return root;
  }
  for (let nodeOffset = 0; nodeOffset < serialized.length; nodeOffset += 1) {
    const entry = serialized[nodeOffset]!;
    const expectedOffsets = expected[nodeOffset] ?? [];
    if (entry.key !== kernel.nodeKeys[nodeOffset]) {
      return `${root}/${nodeOffset}/key`;
    }
    if (entry.edges.length !== expectedOffsets.length) {
      return `${root}/${nodeOffset}/edges`;
    }
    const indexOffset = entry.edges.findIndex(
      (edgeOffset, index) => edgeOffset !== expectedOffsets[index],
    );
    if (indexOffset >= 0) {
      return `${root}/${nodeOffset}/edges/${indexOffset}`;
    }
  }
  return null;
};

export const verifySerializedIndexes = (
  snapshot: Readonly<CompiledPipeline>,
  kernel: GraphKernel,
): string | null => {
  if (snapshot.nodeIndex.length !== kernel.nodeKeys.length) {
    return '/nodeIndex';
  }
  for (let nodeOffset = 0; nodeOffset < snapshot.nodeIndex.length; nodeOffset += 1) {
    const entry = snapshot.nodeIndex[nodeOffset]!;
    if (entry.key !== kernel.nodeKeys[nodeOffset]) {
      return `/nodeIndex/${nodeOffset}/key`;
    }
    if (entry.node !== nodeOffset) {
      return `/nodeIndex/${nodeOffset}/node`;
    }
  }
  return (
    edgeIndexMismatch(snapshot, kernel, 'incoming') ??
    edgeIndexMismatch(snapshot, kernel, 'outgoing')
  );
};
