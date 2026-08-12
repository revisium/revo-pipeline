import type { JsonPointer } from '../../foundation/index.js';
import type { ProgramNodeId } from '../../program/index.js';
import type { SourceNode, SourceRegion } from '../../source/index.js';
import type { LoweringContext } from './contracts.js';
import { createLoweredIdentity } from './identity.js';

const targetRole = (
  node: SourceNode,
  path: JsonPointer,
  context: LoweringContext,
): 'direct' | 'agentSingleActivity' | 'consensusParallel' => {
  if (node.kind === 'consensus') {
    return 'consensusParallel';
  }
  if (node.kind !== 'agent') {
    return 'direct';
  }
  return context.agentSelections.get(path)?.slot.selection.strategy === 'consensus'
    ? 'consensusParallel'
    : 'agentSingleActivity';
};

export const createTargetIds = (
  region: SourceRegion,
  path: JsonPointer,
  context: LoweringContext,
): ReadonlyMap<string, ProgramNodeId> =>
  new Map(
    region.nodes.map((node, index) => {
      const nodePath = `${path}/nodes/${index}` as JsonPointer;
      return [
        node.key,
        createLoweredIdentity(nodePath, targetRole(node, nodePath, context), 0, null).id,
      ];
    }),
  );
