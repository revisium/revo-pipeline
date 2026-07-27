import type { CompiledEdge, CompiledForkRegion, CompiledPipeline } from '../../spec/index.js';
import type { ExpectedCompiledSemantics } from './expected-compiled-semantics.js';

const edgeMismatch = (actual: CompiledEdge, expected: CompiledEdge): string | undefined =>
  (['branch', 'fork', 'from', 'outcome', 'role', 'to'] as const).find(
    (field) => actual[field] !== expected[field],
  );

const regionMismatch = (
  actual: CompiledForkRegion,
  expected: CompiledForkRegion,
): string | null => {
  for (const field of ['fork', 'join'] as const) {
    if (actual[field] !== expected[field]) {
      return `/${field}`;
    }
  }
  if (actual.branches.length !== expected.branches.length) {
    return '/branches';
  }
  for (let index = 0; index < actual.branches.length; index += 1) {
    const branch = actual.branches[index]!;
    const expectedBranch = expected.branches[index]!;
    for (const field of ['entry', 'exit', 'name'] as const) {
      if (branch[field] !== expectedBranch[field]) {
        return `/branches/${index}/${field}`;
      }
    }
    if (
      branch.members.length !== expectedBranch.members.length ||
      branch.members.some((member, memberIndex) => member !== expectedBranch.members[memberIndex])
    ) {
      return `/branches/${index}/members`;
    }
  }
  return null;
};

export const compareSerializedGraph = (
  snapshot: Readonly<CompiledPipeline>,
  expected: Readonly<ExpectedCompiledSemantics>,
): string | null => {
  if (snapshot.nodes.length !== expected.nodeKeys.length) {
    return '/nodes';
  }
  const nodeIndex = snapshot.nodes.findIndex(
    (node, index) => node.key !== expected.nodeKeys[index],
  );
  if (nodeIndex >= 0) {
    return `/nodes/${nodeIndex}/key`;
  }
  if (snapshot.edges.length !== expected.edges.length) {
    return '/edges';
  }
  for (let index = 0; index < snapshot.edges.length; index += 1) {
    const mismatch = edgeMismatch(snapshot.edges[index]!, expected.edges[index]!);
    if (mismatch !== undefined) {
      return `/edges/${index}/${mismatch}`;
    }
  }
  if (snapshot.forkRegions.length !== expected.regions.length) {
    return '/forkRegions';
  }
  for (let index = 0; index < snapshot.forkRegions.length; index += 1) {
    const mismatch = regionMismatch(snapshot.forkRegions[index]!, expected.regions[index]!);
    if (mismatch !== null) {
      return `/forkRegions/${index}${mismatch}`;
    }
  }
  return null;
};
