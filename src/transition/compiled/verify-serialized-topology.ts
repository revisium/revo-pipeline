import {
  reachableNodeOffsets,
  reverseReachableNodeOffsets,
  topologicalOrder,
} from '../../graph/index.js';
import type { GraphKernel } from '../../graph/index.js';
import type { CompiledPipeline } from '../../spec/index.js';

export const verifySerializedTopology = (
  snapshot: Readonly<CompiledPipeline>,
  kernel: GraphKernel,
): readonly number[] | undefined => {
  const expectedOrder = topologicalOrder(kernel);
  if (expectedOrder === null) {
    return undefined;
  }
  const entryOffset = kernel.nodeOffset(snapshot.entry);
  if (entryOffset === undefined) {
    return undefined;
  }
  const terminalOffsets = snapshot.nodes
    .filter((node) => node.kind === 'terminal')
    .map((node) => kernel.nodeOffset(node.key))
    .filter((offset): offset is number => offset !== undefined);
  const reachable = reachableNodeOffsets(kernel, [entryOffset]);
  const leading = reverseReachableNodeOffsets(kernel, terminalOffsets);
  const orderMatches =
    snapshot.topologicalOrder.length === expectedOrder.length &&
    snapshot.topologicalOrder.every(
      (key, position) => key === kernel.nodeKeys[expectedOrder[position] ?? -1],
    );
  return orderMatches && reachable.every(Boolean) && leading.every(Boolean)
    ? expectedOrder
    : undefined;
};
