import { buildGraphKernel, topologicalOrder } from '../../graph/index.js';
import type { CompiledPipeline } from '../../spec/index.js';
import type { DecisionContext } from './decision-context.js';

export const buildDecisionContext = (pipeline: CompiledPipeline): DecisionContext | undefined => {
  const built = buildGraphKernel({
    nodeKeys: pipeline.nodes.map((node) => node.key),
    edges: pipeline.edges,
  });
  if (!built.ok) {
    return undefined;
  }
  const kernel = built.kernel;
  const computedOrder = topologicalOrder(kernel);
  if (computedOrder === null) {
    return undefined;
  }
  if (
    pipeline.topologicalOrder.length !== computedOrder.length ||
    computedOrder.some((offset, position) => {
      return kernel.nodeKeys[offset] !== pipeline.topologicalOrder[position];
    })
  ) {
    return undefined;
  }
  const regionOwnerByNode = new Map<string, string>();
  pipeline.forkRegions.forEach((region) => {
    region.branches.forEach((branch) => {
      branch.members.forEach((member) => regionOwnerByNode.set(member, region.fork));
    });
    regionOwnerByNode.set(region.join, region.fork);
  });
  return {
    compiled: { snapshot: pipeline },
    nodeByKey: new Map(pipeline.nodes.map((node) => [node.key, node])),
    candidatesByNode: new Map(
      pipeline.nodes.flatMap((node) =>
        node.kind === 'consensus' ? [[node.key, new Set(node.candidates)] as const] : [],
      ),
    ),
    incomingByKey: new Map(
      pipeline.nodes.map((node, offset) => [node.key, kernel.incomingEdgeOffsets[offset] ?? []]),
    ),
    outgoingByKey: new Map(
      pipeline.nodes.map((node, offset) => [node.key, kernel.outgoingEdgeOffsets[offset] ?? []]),
    ),
    regionByFork: new Map(pipeline.forkRegions.map((region) => [region.fork, region])),
    regionByJoin: new Map(pipeline.forkRegions.map((region) => [region.join, region])),
    regionOwnerByNode,
    resolutionsByNode: new Map(
      pipeline.nodes.flatMap((node) =>
        node.kind === 'humanGate'
          ? [[node.key, new Set(node.resolutions.map((route) => route.resolution))] as const]
          : [],
      ),
    ),
    topologicalPosition: new Map(pipeline.topologicalOrder.map((key, position) => [key, position])),
  };
};
