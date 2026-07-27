import {
  reachableNodeOffsets,
  reverseReachableNodeOffsets,
  topologicalOrder,
} from '../../graph/index.js';
import type { GraphKernel } from '../../graph/index.js';
import type { CompiledPipeline } from '../../spec/index.js';

type TopologyInspection =
  | { readonly ok: true; readonly offsets: readonly number[] }
  | {
      readonly ok: false;
      readonly code: 'DECODE_GRAPH' | 'DECODE_CANONICAL';
      readonly path: string;
      readonly message: string;
    };

const graphFailure = (path: string, message: string): TopologyInspection => ({
  ok: false,
  code: 'DECODE_GRAPH',
  path,
  message,
});

export const verifySerializedTopology = (
  snapshot: Readonly<CompiledPipeline>,
  kernel: GraphKernel,
): TopologyInspection => {
  const expectedOrder = topologicalOrder(kernel);
  if (expectedOrder === null) {
    return graphFailure('/edges', 'Compiled pipeline graph contains a cycle.');
  }
  const entryOffset = kernel.nodeOffset(snapshot.entry);
  if (entryOffset === undefined) {
    return graphFailure('/entry', 'Compiled pipeline entry is missing from the graph.');
  }
  const terminalOffsets = snapshot.nodes
    .filter((node) => node.kind === 'terminal')
    .map((node) => kernel.nodeOffset(node.key))
    .filter((offset): offset is number => offset !== undefined);
  const reachable = reachableNodeOffsets(kernel, [entryOffset]);
  const unreachable = reachable.findIndex((value) => !value);
  if (unreachable >= 0) {
    return graphFailure(
      `/nodes/${unreachable}/key`,
      'Compiled pipeline node is unreachable from entry.',
    );
  }
  const leading = reverseReachableNodeOffsets(kernel, terminalOffsets);
  const deadEnd = leading.findIndex((value) => !value);
  if (deadEnd >= 0) {
    return graphFailure(`/nodes/${deadEnd}/key`, 'Compiled pipeline node cannot reach a terminal.');
  }
  const orderMatches =
    snapshot.topologicalOrder.length === expectedOrder.length &&
    snapshot.topologicalOrder.every(
      (key, position) => key === kernel.nodeKeys[expectedOrder[position] ?? -1],
    );
  return orderMatches
    ? { ok: true, offsets: expectedOrder }
    : {
        ok: false,
        code: 'DECODE_CANONICAL',
        path: '/topologicalOrder',
        message: 'Compiled pipeline topology is not canonical.',
      };
};
