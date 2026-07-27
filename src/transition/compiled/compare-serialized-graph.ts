import type { CompiledEdge, CompiledForkRegion, CompiledPipeline } from '../../spec/index.js';
import type { ExpectedCompiledSemantics } from './expected-compiled-semantics.js';

const edgesEqual = (actual: CompiledEdge, expected: CompiledEdge): boolean =>
  actual.from === expected.from &&
  actual.outcome === expected.outcome &&
  actual.to === expected.to &&
  actual.role === expected.role &&
  actual.fork === expected.fork &&
  actual.branch === expected.branch;

const regionsEqual = (actual: CompiledForkRegion, expected: CompiledForkRegion): boolean =>
  actual.fork === expected.fork &&
  actual.join === expected.join &&
  actual.branches.length === expected.branches.length &&
  actual.branches.every((branch, branchIndex) => {
    const expectedBranch = expected.branches?.[branchIndex];
    return (
      expectedBranch !== undefined &&
      branch.name === expectedBranch.name &&
      branch.entry === expectedBranch.entry &&
      branch.exit === expectedBranch.exit &&
      branch.members.length === expectedBranch.members.length &&
      branch.members.every((member, memberIndex) => member === expectedBranch.members[memberIndex])
    );
  });

export const compareSerializedGraph = (
  snapshot: Readonly<CompiledPipeline>,
  expected: Readonly<ExpectedCompiledSemantics>,
): boolean =>
  snapshot.nodes.length === expected.nodeKeys.length &&
  snapshot.nodes.every((node, nodeIndex) => node.key === expected.nodeKeys[nodeIndex]) &&
  snapshot.edges.length === expected.edges.length &&
  snapshot.edges.every((edge, edgeIndex) => {
    const expectedEdge = expected.edges[edgeIndex];
    return expectedEdge !== undefined && edgesEqual(edge, expectedEdge);
  }) &&
  snapshot.forkRegions.length === expected.regions.length &&
  snapshot.forkRegions.every((region, regionIndex) => {
    const expectedRegion = expected.regions[regionIndex];
    return expectedRegion !== undefined && regionsEqual(region, expectedRegion);
  });
