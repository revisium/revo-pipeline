import { PIPELINE_LIMITS } from '../../policy/index.js';

interface CompiledCaptureLimit {
  readonly aggregate?: 'incomingOffsets' | 'outgoingOffsets' | 'regionMembers';
  readonly maximum: number;
}

export const compiledCaptureLimit = (path: string): CompiledCaptureLimit => {
  if (
    [
      '/nodes',
      '/topologicalOrder',
      '/forkRegions',
      '/nodeIndex',
      '/incomingIndex',
      '/outgoingIndex',
    ].includes(path)
  ) {
    return { maximum: PIPELINE_LIMITS.definition.nodes };
  }
  if (path === '/edges') {
    return { maximum: PIPELINE_LIMITS.definition.edges };
  }
  if (path === '/facts') {
    return { maximum: PIPELINE_LIMITS.definition.declaredFacts };
  }
  if (/^\/nodes\/\d+\/cases$/u.test(path)) {
    return { maximum: PIPELINE_LIMITS.definition.branchCasesPerNode };
  }
  if (/^\/(?:nodes\/\d+|forkRegions\/\d+)\/branches$/u.test(path)) {
    return { maximum: PIPELINE_LIMITS.definition.forkBranchesPerNode };
  }
  if (/^\/nodes\/\d+\/candidates$/u.test(path)) {
    return { maximum: PIPELINE_LIMITS.definition.candidatesPerNode };
  }
  if (/^\/nodes\/\d+\/resolutions$/u.test(path)) {
    return { maximum: PIPELINE_LIMITS.definition.resolutionsPerNode };
  }
  if (/^\/nodes\/\d+\/cases\/\d+\/when\/values$/u.test(path)) {
    return { maximum: PIPELINE_LIMITS.definition.predicateValuesPerCase };
  }
  if (/^\/incomingIndex\/\d+\/edges$/u.test(path)) {
    return { aggregate: 'incomingOffsets', maximum: PIPELINE_LIMITS.definition.edges };
  }
  if (/^\/outgoingIndex\/\d+\/edges$/u.test(path)) {
    return { aggregate: 'outgoingOffsets', maximum: PIPELINE_LIMITS.definition.edges };
  }
  if (/^\/forkRegions\/\d+\/branches\/\d+\/members$/u.test(path)) {
    return { aggregate: 'regionMembers', maximum: PIPELINE_LIMITS.definition.nodes };
  }
  return { maximum: PIPELINE_LIMITS.facts.total };
};
