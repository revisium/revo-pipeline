import {
  EmptyObjectSchema,
  PipelineFailureValueSchema,
  compareUnicodeCodePoints,
  escapeJsonPointerToken,
  type JsonPointer,
  type ValueSchema,
} from '../../foundation/index.js';
import {
  ConsensusParticipantRegionOutputSchema,
  VoteExitSchema,
  VoteValueSchema,
  type ProgramActivityNode,
  type ProgramEndNode,
  type ProgramNodeId,
  type ProgramRegion,
  type ProgramValueMapping,
  type ProgramVoteBranch,
} from '../../program/index.js';
import type { ValueMapping } from '../../source/index.js';
import type { RequirementUse } from './contracts.js';
import { createLoweredIdentity } from './identity.js';
import { nonEmpty } from './non-empty.js';
import { lowerMapping } from './selectors.js';

export type ConsensusParticipant = {
  readonly key: string;
  readonly bindingKey: string;
  readonly input: ValueMapping;
  readonly inputSchema: ValueSchema;
  readonly requirementSourcePath: JsonPointer;
  readonly materializationPath: JsonPointer | null;
};

export type LoweredConsensusParticipant = {
  readonly branch: ProgramVoteBranch;
  readonly provenance: readonly ReturnType<typeof createLoweredIdentity>['provenance'][];
  readonly requirement: RequirementUse;
};

const identityInput = (mapping: ValueMapping): ProgramValueMapping =>
  Object.freeze(
    Object.fromEntries(
      Object.keys(mapping).map((key) => [
        key,
        Object.freeze({
          kind: 'scopeInput' as const,
          pointer: `/${escapeJsonPointerToken(key)}`,
        }),
      ]),
    ),
  );

const participantEnds = (
  sourcePath: JsonPointer,
  participantIndex: number,
  activityId: `sha256:${string}`,
  materializationPath: JsonPointer | null,
): {
  readonly nodes: readonly [ProgramEndNode, ProgramEndNode, ProgramEndNode];
  readonly provenance: readonly ReturnType<typeof createLoweredIdentity>['provenance'][];
} => {
  const identities = [
    createLoweredIdentity(
      sourcePath,
      'consensusParticipantExit',
      participantIndex * 3,
      materializationPath,
    ),
    createLoweredIdentity(
      sourcePath,
      'consensusParticipantExit',
      participantIndex * 3 + 1,
      materializationPath,
    ),
    createLoweredIdentity(
      sourcePath,
      'consensusParticipantExit',
      participantIndex * 3 + 2,
      materializationPath,
    ),
  ] as const;
  const [vote, failed, cancelled] = identities;
  const nodes: [ProgramEndNode, ProgramEndNode, ProgramEndNode] = [
    Object.freeze({
      kind: 'end',
      id: vote.id,
      outcome: 'vote',
      output: Object.freeze({
        vote: Object.freeze({ kind: 'nodeOutput', nodeId: activityId, pointer: '' }),
      }),
    }),
    Object.freeze({
      kind: 'end',
      id: failed.id,
      outcome: 'failed',
      output: Object.freeze({
        code: Object.freeze({ kind: 'nodeFailure', nodeId: activityId, pointer: '/code' }),
        path: Object.freeze({ kind: 'nodeFailure', nodeId: activityId, pointer: '/path' }),
      }),
    }),
    Object.freeze({
      kind: 'end',
      id: cancelled.id,
      outcome: 'cancelled',
      output: Object.freeze({}),
    }),
  ];
  return Object.freeze({
    nodes: Object.freeze(nodes),
    provenance: Object.freeze(identities.map(({ provenance }) => provenance)),
  });
};

const participantRegion = (
  id: ProgramNodeId,
  participant: ConsensusParticipant,
  activity: ProgramActivityNode,
  ends: ReturnType<typeof participantEnds>,
): ProgramRegion => {
  const nodes = nonEmpty(
    [activity, ...ends.nodes].sort((left, right) => compareUnicodeCodePoints(left.id, right.id)),
    'Expected a generated consensus participant region.',
  );
  return Object.freeze({
    id,
    inputSchema: participant.inputSchema,
    entry: activity.id,
    outputSchema: ConsensusParticipantRegionOutputSchema,
    exits: nonEmpty(
      [
        Object.freeze({ outcome: 'cancelled', outputSchema: EmptyObjectSchema }),
        Object.freeze({ outcome: 'failed', outputSchema: PipelineFailureValueSchema }),
        Object.freeze({ outcome: 'vote', outputSchema: VoteExitSchema }),
      ],
      'Expected generated consensus participant exits.',
    ),
    nodes,
  });
};

export const lowerConsensusParticipant = (
  sourcePath: JsonPointer,
  participant: ConsensusParticipant,
  participantIndex: number,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
): LoweredConsensusParticipant => {
  const materializationPath = participant.materializationPath;
  const regionIdentity = createLoweredIdentity(
    sourcePath,
    'consensusParticipantRegion',
    participantIndex,
    materializationPath,
  );
  const activityIdentity = createLoweredIdentity(
    sourcePath,
    'consensusParticipantActivity',
    participantIndex,
    materializationPath,
  );
  const ends = participantEnds(
    sourcePath,
    participantIndex,
    activityIdentity.id,
    materializationPath,
  );
  const activity: ProgramActivityNode = Object.freeze({
    kind: 'activity',
    id: activityIdentity.id,
    activityKind: 'agent',
    requirementKey: participant.bindingKey,
    input: identityInput(participant.input),
    inputSchema: participant.inputSchema,
    outputSchema: VoteValueSchema,
    routes: Object.freeze({
      succeeded: ends.nodes[0].id,
      failed: ends.nodes[1].id,
      cancelled: ends.nodes[2].id,
    }),
  });
  const region = participantRegion(regionIdentity.id, participant, activity, ends);
  const requirement = Object.freeze({
    kind: 'agent' as const,
    key: participant.bindingKey,
    bindingKey: participant.bindingKey,
    inputSchema: participant.inputSchema,
    outputSchema: VoteValueSchema,
  });
  return Object.freeze({
    branch: Object.freeze({
      key: participant.key,
      bindingKey: participant.bindingKey,
      input: lowerMapping(participant.input, targetIds),
      region,
    }),
    provenance: Object.freeze([
      regionIdentity.provenance,
      activityIdentity.provenance,
      ...ends.provenance,
    ]),
    requirement: Object.freeze({
      requirement,
      sourcePath: participant.requirementSourcePath,
      materializationPath,
    }),
  });
};
