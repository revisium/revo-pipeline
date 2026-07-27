import type { HostileCompiledValidation } from '../compiled/hostile-compiled-validation.js';
import type { DecisionContext } from './decision-context.js';

type SuccessfulCompiledValidation = Extract<HostileCompiledValidation, { readonly ok: true }>;

export const buildDecisionContext = (compiled: SuccessfulCompiledValidation): DecisionContext => {
  const { snapshot, kernel, topologicalOffsets } = compiled;
  const regionOwnerByNode = new Map<string, string>();
  snapshot.forkRegions.forEach((region) => {
    region.branches.forEach((branch) => {
      branch.members.forEach((member) => regionOwnerByNode.set(member, region.fork));
    });
    regionOwnerByNode.set(region.join, region.fork);
  });
  return {
    compiled,
    nodeByKey: new Map(snapshot.nodes.map((node) => [node.key, node])),
    candidatesByNode: new Map(
      snapshot.nodes.flatMap((node) =>
        node.kind === 'consensus' ? [[node.key, new Set(node.candidates)] as const] : [],
      ),
    ),
    incomingByKey: new Map(
      snapshot.nodes.map((node, offset) => [node.key, kernel.incomingEdgeOffsets[offset] ?? []]),
    ),
    outgoingByKey: new Map(
      snapshot.nodes.map((node, offset) => [node.key, kernel.outgoingEdgeOffsets[offset] ?? []]),
    ),
    regionByFork: new Map(snapshot.forkRegions.map((region) => [region.fork, region])),
    regionByJoin: new Map(snapshot.forkRegions.map((region) => [region.join, region])),
    regionOwnerByNode,
    resolutionsByNode: new Map(
      snapshot.nodes.flatMap((node) =>
        node.kind === 'humanGate'
          ? [[node.key, new Set(node.resolutions.map((route) => route.resolution))] as const]
          : [],
      ),
    ),
    topologicalPosition: new Map(
      topologicalOffsets.flatMap((offset, position) => {
        const key = kernel.nodeKeys[offset];
        return key === undefined ? [] : [[key, position] as const];
      }),
    ),
  };
};
