import { PIPELINE_LIMITS } from '../../policy/index.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const dataValue = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};

const precheckNestedBounds = (nodes: readonly unknown[]): boolean => {
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = dataValue(nodes, String(nodeIndex));
    if (!isRecord(node)) {
      continue;
    }
    const cases = dataValue(node, 'cases');
    const branches = dataValue(node, 'branches');
    const candidates = dataValue(node, 'candidates');
    const resolutions = dataValue(node, 'resolutions');
    if (
      (Array.isArray(cases) && cases.length > PIPELINE_LIMITS.definition.branchCasesPerNode) ||
      (Array.isArray(branches) &&
        branches.length > PIPELINE_LIMITS.definition.forkBranchesPerNode) ||
      (Array.isArray(candidates) &&
        candidates.length > PIPELINE_LIMITS.definition.candidatesPerNode) ||
      (Array.isArray(resolutions) &&
        resolutions.length > PIPELINE_LIMITS.definition.resolutionsPerNode)
    ) {
      return false;
    }
    if (!Array.isArray(cases)) {
      continue;
    }
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const entry = dataValue(cases, String(caseIndex));
      if (!isRecord(entry)) {
        continue;
      }
      const when = dataValue(entry, 'when');
      if (!isRecord(when)) {
        continue;
      }
      const values = dataValue(when, 'values');
      if (
        Array.isArray(values) &&
        values.length > PIPELINE_LIMITS.definition.predicateValuesPerCase
      ) {
        return false;
      }
    }
  }
  return true;
};

const precheckRegionBounds = (regions: readonly unknown[]): boolean => {
  let totalMembers = 0;
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
    const region = dataValue(regions, String(regionIndex));
    if (!isRecord(region)) {
      continue;
    }
    const branches = dataValue(region, 'branches');
    if (
      Array.isArray(branches) &&
      branches.length > PIPELINE_LIMITS.definition.forkBranchesPerNode
    ) {
      return false;
    }
    if (!Array.isArray(branches)) {
      continue;
    }
    for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
      const branch = dataValue(branches, String(branchIndex));
      if (!isRecord(branch)) {
        continue;
      }
      const members = dataValue(branch, 'members');
      if (Array.isArray(members) && members.length > PIPELINE_LIMITS.definition.nodes) {
        return false;
      }
      if (Array.isArray(members)) {
        totalMembers += members.length;
        if (totalMembers > PIPELINE_LIMITS.definition.nodes) {
          return false;
        }
      }
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
