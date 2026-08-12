import type {
  PipelineProgram,
  ProgramNode,
  ProgramNodeId,
  ProgramRegion,
} from '../../program/index.js';

export type ProgramStructure = {
  readonly ids: readonly ProgramNodeId[];
  readonly activityRequirements: readonly {
    readonly nodeId: ProgramNodeId;
    readonly requirementKey: string;
  }[];
};

const childRegions = (node: ProgramNode): readonly ProgramRegion[] => {
  if (node.kind === 'parallel') {
    return node.branches.map(({ region }) => region);
  }
  if (node.kind === 'repeat' || node.kind === 'map') {
    return [node.body];
  }
  return [];
};

const inspectRegion = (
  region: ProgramRegion,
  ids: ProgramNodeId[],
  activities: { nodeId: ProgramNodeId; requirementKey: string }[],
): void => {
  ids.push(region.id);
  for (const node of region.nodes) {
    ids.push(node.id);
    if (node.kind === 'activity') {
      activities.push({ nodeId: node.id, requirementKey: node.requirementKey });
    }
    for (const child of childRegions(node)) {
      inspectRegion(child, ids, activities);
    }
  }
};

export const inspectProgramStructure = (program: PipelineProgram): ProgramStructure => {
  const ids: ProgramNodeId[] = [];
  const activityRequirements: { nodeId: ProgramNodeId; requirementKey: string }[] = [];
  for (const module of program.modules) {
    inspectRegion(module.region, ids, activityRequirements);
  }
  return Object.freeze({
    ids: Object.freeze(ids),
    activityRequirements: Object.freeze(activityRequirements),
  });
};
