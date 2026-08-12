import {
  compareUnicodeCodePoints,
  type ConsensusPolicy,
  type JsonPointer,
} from '../../foundation/index.js';
import type { ProgramChoiceNode, ProgramParallelNode } from '../../program/index.js';
import type { AgentSourceNode, ConsensusRoutes, ConsensusSourceNode } from '../../source/index.js';
import { lowerConsensusParticipant, type ConsensusParticipant } from './consensus-participant.js';
import type { LoweredNodeFragment, LoweringContext } from './contracts.js';
import { createLoweredIdentity } from './identity.js';
import { nonEmpty } from './non-empty.js';
import { targetId } from './routes.js';

const consensusCases = Object.freeze([
  'approved',
  'cancelled',
  'inconclusive',
  'participantFailed',
  'rejected',
] as const);

type ConsensusInput = {
  readonly sourcePath: JsonPointer;
  readonly materializationPath: JsonPointer | null;
  readonly participants: readonly ConsensusParticipant[];
  readonly policy: ConsensusPolicy;
  readonly remaining: 'drain' | 'cancel';
  readonly routes: ConsensusRoutes;
};

const lowerVoteTopology = (
  input: ConsensusInput,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
): LoweredNodeFragment => {
  const parallelIdentity = createLoweredIdentity(
    input.sourcePath,
    'consensusParallel',
    0,
    input.materializationPath,
  );
  const choiceIdentity = createLoweredIdentity(
    input.sourcePath,
    'consensusChoice',
    0,
    input.materializationPath,
  );
  const participants = [...input.participants]
    .sort((left, right) => compareUnicodeCodePoints(left.key, right.key))
    .map((participant, index) =>
      lowerConsensusParticipant(input.sourcePath, participant, index, targetIds),
    );
  const branches = participants.map(({ branch }) => branch);
  const parallel: ProgramParallelNode = Object.freeze({
    kind: 'parallel',
    id: parallelIdentity.id,
    mode: 'votes',
    branches: nonEmpty(branches, 'Expected validated consensus participants.'),
    policy: input.policy,
    remaining: input.remaining,
    next: choiceIdentity.id,
  });
  const cases = consensusCases.map((classification) =>
    Object.freeze({
      key: classification,
      when: Object.freeze({ kind: 'equals' as const, value: classification }),
      target: targetId(input.routes[classification], targetIds),
    }),
  );
  const choice: ProgramChoiceNode = Object.freeze({
    kind: 'choice',
    id: choiceIdentity.id,
    selector: Object.freeze({
      kind: 'nodeOutput',
      nodeId: parallelIdentity.id,
      pointer: '/classification',
    }),
    cases: nonEmpty(cases, 'Expected generated consensus cases.'),
    otherwise: null,
  });
  return Object.freeze({
    nodes: Object.freeze([parallel, choice]),
    provenance: Object.freeze([
      parallelIdentity.provenance,
      choiceIdentity.provenance,
      ...participants.flatMap(({ provenance }) => provenance),
    ]),
    requirements: Object.freeze(participants.map(({ requirement }) => requirement)),
  });
};

export const lowerExplicitConsensus = (
  node: ConsensusSourceNode,
  path: JsonPointer,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
): LoweredNodeFragment =>
  lowerVoteTopology(
    {
      sourcePath: path,
      materializationPath: null,
      participants: node.participants.map((participant, index) => ({
        ...participant,
        requirementSourcePath: `${path}/participants/${index}`,
        materializationPath: null,
      })),
      policy: node.policy,
      remaining: node.remaining,
      routes: node.routes,
    },
    targetIds,
  );

export const lowerSlotConsensus = (
  node: AgentSourceNode,
  path: JsonPointer,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
  context: LoweringContext,
): LoweredNodeFragment => {
  const selected = context.agentSelections.get(path);
  if (selected?.slot.selection.strategy !== 'consensus') {
    throw new TypeError('Expected a validated consensus materialization.');
  }
  const strategy = node.strategies.find(({ kind }) => kind === 'consensus');
  if (strategy?.kind !== 'consensus') {
    throw new TypeError('Expected a validated consensus strategy.');
  }
  const selectionPath = `/slots/${selected.slotIndex}/selection` as JsonPointer;
  return lowerVoteTopology(
    {
      sourcePath: path,
      materializationPath: selectionPath,
      participants: selected.slot.selection.participants.map((participant, index) => ({
        ...participant,
        input: node.input,
        inputSchema: node.inputSchema,
        requirementSourcePath: path,
        materializationPath: `${selectionPath}/participants/${index}`,
      })),
      policy: strategy.policy,
      remaining: strategy.remaining,
      routes: strategy.routes,
    },
    targetIds,
  );
};
