import {
  EmptyObjectSchema,
  compareUnicodeCodePoints,
  type JsonPointer,
} from '../../foundation/index.js';
import type { ProgramNode, ProgramRegion } from '../../program/index.js';
import type { SourceNode, SourceRegion } from '../../source/index.js';
import { lowerExplicitConsensus, lowerSlotConsensus } from './consensus.js';
import type { LoweredNodeFragment, LoweredRegion, LoweringContext } from './contracts.js';
import { lowerDirect, lowerSingleAgent } from './direct.js';
import { createLoweredIdentity } from './identity.js';
import { lowerMap, lowerParallel, lowerRepeat } from './structured.js';
import { createTargetIds } from './target-ids.js';

const lowerNode = (
  node: SourceNode,
  path: JsonPointer,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
  context: LoweringContext,
): LoweredNodeFragment => {
  switch (node.kind) {
    case 'agent':
      return context.agentSelections.get(path)?.slot.selection.strategy === 'consensus'
        ? lowerSlotConsensus(node, path, targetIds, context)
        : lowerSingleAgent(node, path, targetIds, context);
    case 'parallel':
      return lowerParallel(node, path, targetIds, context, lowerRegion);
    case 'repeat':
      return lowerRepeat(node, path, targetIds, context, lowerRegion);
    case 'map':
      return lowerMap(node, path, targetIds, context, lowerRegion);
    case 'consensus':
      return lowerExplicitConsensus(node, path, targetIds);
    case 'script':
    case 'effect':
    case 'choice':
    case 'call':
    case 'wait':
    case 'humanGate':
    case 'end':
      return lowerDirect(node, path, targetIds);
  }
  throw new TypeError('Unexpected schema-validated source node.');
};

const nonEmptyNodes = (nodes: ProgramNode[]): ProgramRegion['nodes'] => {
  const [first, ...rest] = nodes.toSorted((left, right) =>
    compareUnicodeCodePoints(left.id, right.id),
  );
  if (first === undefined) {
    throw new TypeError('Expected a validated non-empty region.');
  }
  return Object.freeze([first, ...rest]);
};

export const lowerRegion = (
  region: SourceRegion,
  path: JsonPointer,
  context: LoweringContext,
): LoweredRegion => {
  const identity = createLoweredIdentity(path, 'direct', 0, null);
  const targetIds = createTargetIds(region, path, context);
  const fragments = region.nodes.map((node, index) =>
    lowerNode(node, `${path}/nodes/${index}`, targetIds, context),
  );
  const entry = targetIds.get(region.entry);
  if (entry === undefined) {
    throw new TypeError('Expected a validated region entry.');
  }
  return Object.freeze({
    region: Object.freeze({
      id: identity.id,
      inputSchema: region.inputSchema ?? EmptyObjectSchema,
      entry,
      outputSchema: region.outputSchema,
      exits: region.exits,
      nodes: nonEmptyNodes(fragments.flatMap(({ nodes }) => nodes)),
    }),
    provenance: Object.freeze([
      identity.provenance,
      ...fragments.flatMap(({ provenance }) => provenance),
    ]),
    requirements: Object.freeze(fragments.flatMap(({ requirements }) => requirements)),
  });
};
