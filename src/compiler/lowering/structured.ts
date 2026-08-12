import type { JsonPointer } from '../../foundation/index.js';
import type {
  ProgramMapNode,
  ProgramChoiceNode,
  ProgramParallelBranch,
  ProgramParallelNode,
  ProgramRepeatNode,
} from '../../program/index.js';
import type { MapSourceNode, ParallelSourceNode, RepeatSourceNode } from '../../source/index.js';
import type { LoweredNodeFragment, LoweringContext, RegionLowerer } from './contracts.js';
import { createLoweredIdentity } from './identity.js';
import { atLeastTwo, nonEmpty } from './non-empty.js';
import { mapTargetRoutes, repeatTargetRoutes, targetId } from './routes.js';
import { lowerMapping, lowerRepeatCondition, lowerSelector } from './selectors.js';

const genericCases = Object.freeze(['cancelled', 'completed', 'failed', 'impossible'] as const);

const lowerParallelBranch = (
  nodePath: JsonPointer,
  branch: ParallelSourceNode['branches'][number],
  index: number,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
  context: LoweringContext,
  lowerRegion: RegionLowerer,
): { readonly branch: ProgramParallelBranch; readonly lowered: ReturnType<RegionLowerer> } => {
  const lowered = lowerRegion(branch.region, `${nodePath}/branches/${index}/region`, context);
  return Object.freeze({
    branch: Object.freeze({
      key: branch.key,
      input: lowerMapping(branch.input, targetIds),
      region: lowered.region,
      exits: branch.exits,
    }),
    lowered,
  });
};

export const lowerParallel = (
  node: ParallelSourceNode,
  path: JsonPointer,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
  context: LoweringContext,
  lowerRegion: RegionLowerer,
): LoweredNodeFragment => {
  const parallelIdentity = createLoweredIdentity(path, 'direct', 0, null);
  const choiceIdentity = createLoweredIdentity(path, 'genericParallelChoice', 0, null);
  const loweredBranches = node.branches.map((branch, index) =>
    lowerParallelBranch(path, branch, index, targetIds, context, lowerRegion),
  );
  const branches = loweredBranches.map(({ branch }) => branch);
  const parallel: ProgramParallelNode = Object.freeze({
    kind: 'parallel',
    id: parallelIdentity.id,
    mode: 'generic',
    branches: atLeastTwo(branches, 'Expected validated parallel branches.'),
    policy: node.policy,
    remaining: node.remaining,
    next: choiceIdentity.id,
  });
  const cases = genericCases.map((classification) =>
    Object.freeze({
      key: classification,
      when: Object.freeze({ kind: 'equals' as const, value: classification }),
      target: targetId(node.routes[classification], targetIds),
    }),
  );
  const choice: ProgramChoiceNode = Object.freeze({
    kind: 'choice',
    id: choiceIdentity.id,
    selector: Object.freeze({
      kind: 'nodeOutput' as const,
      nodeId: parallelIdentity.id,
      pointer: '/classification' as const,
    }),
    cases: nonEmpty(cases, 'Expected generated parallel cases.'),
    otherwise: null,
  });
  return Object.freeze({
    nodes: Object.freeze([parallel, choice]),
    provenance: Object.freeze([
      parallelIdentity.provenance,
      choiceIdentity.provenance,
      ...loweredBranches.flatMap(({ lowered }) => lowered.provenance),
    ]),
    requirements: Object.freeze(loweredBranches.flatMap(({ lowered }) => lowered.requirements)),
  });
};

export const lowerRepeat = (
  node: RepeatSourceNode,
  path: JsonPointer,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
  context: LoweringContext,
  lowerRegion: RegionLowerer,
): LoweredNodeFragment => {
  const identity = createLoweredIdentity(path, 'direct', 0, null);
  const body = lowerRegion(node.body, `${path}/body`, context);
  const programNode: ProgramRepeatNode = Object.freeze({
    kind: 'repeat',
    id: identity.id,
    maximumIterations: node.maximumIterations,
    initialInput: lowerMapping(node.initialInput, targetIds),
    nextInput: lowerMapping(node.nextInput, targetIds),
    body: body.region,
    bodyExits: node.bodyExits,
    continueWhen: lowerRepeatCondition(node.continueWhen, targetIds),
    output: lowerMapping(node.output, targetIds),
    outputSchema: node.outputSchema,
    routes: repeatTargetRoutes(node.routes, targetIds),
  });
  return Object.freeze({
    nodes: Object.freeze([programNode]),
    provenance: Object.freeze([identity.provenance, ...body.provenance]),
    requirements: body.requirements,
  });
};

export const lowerMap = (
  node: MapSourceNode,
  path: JsonPointer,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
  context: LoweringContext,
  lowerRegion: RegionLowerer,
): LoweredNodeFragment => {
  const identity = createLoweredIdentity(path, 'direct', 0, null);
  const body = lowerRegion(node.body, `${path}/body`, context);
  const programNode: ProgramMapNode = Object.freeze({
    kind: 'map',
    id: identity.id,
    items: lowerSelector(node.items, targetIds),
    itemKeyPointer: node.itemKeyPointer,
    maximumItems: node.maximumItems,
    maximumConcurrency: node.maximumConcurrency,
    bodyInput: lowerMapping(node.bodyInput, targetIds),
    body: body.region,
    bodyExits: node.bodyExits,
    failure: node.failure,
    routes: mapTargetRoutes(node.routes, targetIds),
  });
  return Object.freeze({
    nodes: Object.freeze([programNode]),
    provenance: Object.freeze([identity.provenance, ...body.provenance]),
    requirements: body.requirements,
  });
};
