import type { ProgramAdmissionReceipt, ProgramNodeId } from '../../program/index.js';

export type ProgramStructure = {
  readonly ids: readonly ProgramNodeId[];
  readonly activityRequirements: readonly {
    readonly nodeId: ProgramNodeId;
    readonly requirementKey: string;
  }[];
};

export const inspectProgramStructure = (receipt: ProgramAdmissionReceipt): ProgramStructure => {
  const ids: ProgramNodeId[] = [];
  const activityRequirements: { nodeId: ProgramNodeId; requirementKey: string }[] = [];
  for (const region of receipt.index.regions.values()) {
    ids.push(region.id);
    for (const node of region.nodes) {
      ids.push(node.id);
      if (node.kind === 'activity') {
        activityRequirements.push({ nodeId: node.id, requirementKey: node.requirementKey });
      }
    }
  }
  return Object.freeze({
    ids: Object.freeze(ids),
    activityRequirements: Object.freeze(activityRequirements),
  });
};
