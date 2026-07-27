import { PIPELINE_LIMITS } from '../../policy/index.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const dataValue = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};

const exceedsArrayBound = (value: unknown, maximum: number): boolean =>
  Array.isArray(value) && value.length > maximum;

interface NodeCollections {
  readonly branches: unknown;
  readonly candidates: unknown;
  readonly cases: unknown;
  readonly resolutions: unknown;
}

const readNodeCollections = (node: Record<string, unknown>): NodeCollections => ({
  cases: dataValue(node, 'cases'),
  branches: dataValue(node, 'branches'),
  candidates: dataValue(node, 'candidates'),
  resolutions: dataValue(node, 'resolutions'),
});

const nodeCollectionsAreBounded = (collections: NodeCollections): boolean =>
  !exceedsArrayBound(collections.cases, PIPELINE_LIMITS.definition.branchCasesPerNode) &&
  !exceedsArrayBound(collections.branches, PIPELINE_LIMITS.definition.forkBranchesPerNode) &&
  !exceedsArrayBound(collections.candidates, PIPELINE_LIMITS.definition.candidatesPerNode) &&
  !exceedsArrayBound(collections.resolutions, PIPELINE_LIMITS.definition.resolutionsPerNode);

const casePredicatesAreBounded = (cases: readonly unknown[]): boolean => {
  for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
    const entry = dataValue(cases, String(caseIndex));
    if (!isRecord(entry)) {
      continue;
    }
    const when = dataValue(entry, 'when');
    if (
      isRecord(when) &&
      exceedsArrayBound(
        dataValue(when, 'values'),
        PIPELINE_LIMITS.definition.predicateValuesPerCase,
      )
    ) {
      return false;
    }
  }
  return true;
};

const precheckNestedBounds = (nodes: readonly unknown[]): boolean => {
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = dataValue(nodes, String(nodeIndex));
    if (!isRecord(node)) {
      continue;
    }
    const collections = readNodeCollections(node);
    if (
      !nodeCollectionsAreBounded(collections) ||
      (Array.isArray(collections.cases) && !casePredicatesAreBounded(collections.cases))
    ) {
      return false;
    }
  }
  return true;
};

const boundedRegionMemberCount = (branches: readonly unknown[]): number | undefined => {
  let count = 0;
  for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
    const branch = dataValue(branches, String(branchIndex));
    if (!isRecord(branch)) {
      continue;
    }
    const members = dataValue(branch, 'members');
    if (exceedsArrayBound(members, PIPELINE_LIMITS.definition.nodes)) {
      return undefined;
    }
    if (Array.isArray(members)) {
      count += members.length;
    }
  }
  return count;
};

const precheckRegionBounds = (regions: readonly unknown[]): boolean => {
  let totalMembers = 0;
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
    const region = dataValue(regions, String(regionIndex));
    if (!isRecord(region)) {
      continue;
    }
    const branches = dataValue(region, 'branches');
    if (exceedsArrayBound(branches, PIPELINE_LIMITS.definition.forkBranchesPerNode)) {
      return false;
    }
    const memberCount = Array.isArray(branches) ? boundedRegionMemberCount(branches) : 0;
    if (memberCount === undefined) {
      return false;
    }
    totalMembers += memberCount;
    if (totalMembers > PIPELINE_LIMITS.definition.nodes) {
      return false;
    }
  }
  return true;
};

const precheckIndexOffsets = (entries: readonly unknown[]): boolean => {
  let total = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = dataValue(entries, String(index));
    if (!isRecord(entry)) {
      continue;
    }
    const offsets = dataValue(entry, 'edges');
    if (Array.isArray(offsets) && offsets.length > PIPELINE_LIMITS.definition.edges) {
      return false;
    }
    if (Array.isArray(offsets)) {
      total += offsets.length;
      if (!Number.isSafeInteger(total) || total > PIPELINE_LIMITS.definition.edges) {
        return false;
      }
    }
  }
  return true;
};

export const precheckCompiledBounds = (input: unknown): boolean => {
  if (!isRecord(input)) {
    return true;
  }
  const nodes = dataValue(input, 'nodes');
  const edges = dataValue(input, 'edges');
  const facts = dataValue(input, 'facts');
  const topology = dataValue(input, 'topologicalOrder');
  const forkRegions = dataValue(input, 'forkRegions');
  const nodeIndex = dataValue(input, 'nodeIndex');
  const incomingIndex = dataValue(input, 'incomingIndex');
  const outgoingIndex = dataValue(input, 'outgoingIndex');
  const bounds: readonly [unknown, number][] = [
    [nodes, PIPELINE_LIMITS.definition.nodes],
    [edges, PIPELINE_LIMITS.definition.edges],
    [facts, PIPELINE_LIMITS.definition.declaredFacts],
    [topology, PIPELINE_LIMITS.definition.nodes],
    [forkRegions, PIPELINE_LIMITS.definition.nodes],
    [nodeIndex, PIPELINE_LIMITS.definition.nodes],
    [incomingIndex, PIPELINE_LIMITS.definition.nodes],
    [outgoingIndex, PIPELINE_LIMITS.definition.nodes],
  ];
  if (bounds.some(([value, maximum]) => Array.isArray(value) && value.length > maximum)) {
    return false;
  }
  return (
    (!Array.isArray(nodes) || precheckNestedBounds(nodes)) &&
    (!Array.isArray(forkRegions) || precheckRegionBounds(forkRegions)) &&
    (!Array.isArray(incomingIndex) || precheckIndexOffsets(incomingIndex)) &&
    (!Array.isArray(outgoingIndex) || precheckIndexOffsets(outgoingIndex))
  );
};
