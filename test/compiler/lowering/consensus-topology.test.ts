import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import { EmptyObjectSchema, PipelineFailureValueSchema } from '../../../src/foundation/index.js';
import {
  ConsensusParticipantRegionOutputSchema,
  VoteExitSchema,
  VoteValueSchema,
} from '../../../src/program/index.js';
import type { PipelineSourcePackage } from '../../../src/source/index.js';
import { consensusAgentNode, materializationFor } from '../../support/compiler-builders.js';
import { consensusIdentityRecords } from '../../support/compiler-vectors.js';
import { sourceForNode, sourceNodeBuilders } from '../../support/source-builders.js';

const participantInputSchema = {
  type: 'object',
  properties: { request: { type: 'string', enum: ['review'] } },
  required: ['request'],
  additionalProperties: false,
} as const;
const parentParticipantInput = {
  request: { kind: 'literal', value: 'review' },
} as const;
const participantActivityInput = {
  request: { kind: 'scopeInput', pointer: '/request' },
} as const;

const successful = (
  source: PipelineSourcePackage,
  materialization = materializationFor(source),
) => {
  const result = compilePipeline(source, materialization);
  if (!result.ok) {
    throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
  }
  return result;
};

const voteTopology = (program: ReturnType<typeof successful>['program']) => {
  const parallel = program.modules[0].region.nodes.find(
    (node) => node.kind === 'parallel' && node.mode === 'votes',
  );
  const choice = program.modules[0].region.nodes.find(({ kind }) => kind === 'choice');
  if (parallel?.kind !== 'parallel' || parallel.mode !== 'votes' || choice?.kind !== 'choice') {
    throw new TypeError('Expected vote parallel and generated choice.');
  }
  const participants = parallel.branches.map(({ key, bindingKey, input, region }) => {
    const activity = region.nodes.find(({ kind }) => kind === 'activity');
    if (activity?.kind !== 'activity') {
      throw new TypeError('Expected participant activity.');
    }
    const ends = Object.fromEntries(
      region.nodes.filter((node) => node.kind === 'end').map((node) => [node.outcome, node]),
    );
    return {
      key,
      bindingKey,
      input,
      region: {
        entry: region.entry,
        inputSchema: region.inputSchema,
        outputSchema: region.outputSchema,
        exits: region.exits,
        nodeIds: region.nodes.map(({ id }) => id),
      },
      activity,
      ends,
    };
  });
  return { parallel, choice, participants };
};

const expectParticipantContracts = (
  participants: ReturnType<typeof voteTopology>['participants'],
) => {
  for (const participant of participants) {
    expect(participant.region).toEqual({
      entry: participant.activity.id,
      inputSchema: participantInputSchema,
      outputSchema: ConsensusParticipantRegionOutputSchema,
      exits: [
        { outcome: 'cancelled', outputSchema: EmptyObjectSchema },
        { outcome: 'failed', outputSchema: PipelineFailureValueSchema },
        { outcome: 'vote', outputSchema: VoteExitSchema },
      ],
      nodeIds: participant.region.nodeIds.toSorted(),
    });
    expect(participant.activity).toEqual({
      kind: 'activity',
      id: participant.activity.id,
      activityKind: 'agent',
      requirementKey: participant.bindingKey,
      input: participantActivityInput,
      inputSchema: participantInputSchema,
      outputSchema: VoteValueSchema,
      routes: {
        succeeded: participant.ends.vote?.id,
        failed: participant.ends.failed?.id,
        cancelled: participant.ends.cancelled?.id,
      },
    });
    expect(participant.ends).toEqual({
      vote: {
        kind: 'end',
        id: participant.ends.vote?.id,
        outcome: 'vote',
        output: { vote: { kind: 'nodeOutput', nodeId: participant.activity.id, pointer: '' } },
      },
      failed: {
        kind: 'end',
        id: participant.ends.failed?.id,
        outcome: 'failed',
        output: {
          code: { kind: 'nodeFailure', nodeId: participant.activity.id, pointer: '/code' },
          path: { kind: 'nodeFailure', nodeId: participant.activity.id, pointer: '/path' },
        },
      },
      cancelled: {
        kind: 'end',
        id: participant.ends.cancelled?.id,
        outcome: 'cancelled',
        output: {},
      },
    });
  }
};

const exactChoice = (
  choice: ReturnType<typeof voteTopology>['choice'],
  parallel: ReturnType<typeof voteTopology>['parallel'],
) => ({
  kind: 'choice' as const,
  id: choice.id,
  selector: {
    kind: 'nodeOutput' as const,
    nodeId: parallel.id,
    pointer: '/classification' as const,
  },
  cases: ['approved', 'cancelled', 'inconclusive', 'participantFailed', 'rejected'].map(
    (classification) => ({
      key: classification,
      when: { kind: 'equals' as const, value: classification },
      target: 'sha256:7388e9d9d2d01d94be0ebfed33faf046f9ad740d839fb27ad18c65a10335def2',
    }),
  ),
  otherwise: null,
});

const expectedConsensusProvenance = (materialized: boolean) =>
  consensusIdentityRecords.map(({ programNodeId, loweringRole, ordinal, participantIndex }) => ({
    programNodeId,
    sourcePath: '/modules/0/region/nodes/0',
    materializationPath: materialized
      ? participantIndex === null
        ? '/slots/0/selection'
        : `/slots/0/selection/participants/${participantIndex}`
      : null,
    loweringRole,
    ordinal,
  }));

const consensusProvenance = (result: ReturnType<typeof successful>) =>
  result.provenance.nodes.filter(({ loweringRole }) => loweringRole.startsWith('consensus'));

describe('consensus lowering topology', () => {
  it('emits exact explicit-consensus participants, routing, and provenance', () => {
    const consensus = sourceNodeBuilders.consensus();
    const result = successful(
      sourceForNode({
        ...consensus,
        participants: [
          {
            key: 'équipe',
            bindingKey: 'equipe-binding',
            input: parentParticipantInput,
            inputSchema: participantInputSchema,
          },
          {
            key: 'alpha',
            bindingKey: 'alpha-binding',
            input: parentParticipantInput,
            inputSchema: participantInputSchema,
          },
        ],
      }),
    );
    const { parallel, choice, participants } = voteTopology(result.program);

    expectParticipantContracts(participants);
    expect(participants.map(({ key, bindingKey, input }) => ({ key, bindingKey, input }))).toEqual([
      { key: 'alpha', bindingKey: 'alpha-binding', input: parentParticipantInput },
      { key: 'équipe', bindingKey: 'equipe-binding', input: parentParticipantInput },
    ]);
    expect(parallel).toMatchObject({
      id: 'sha256:b7398c2a4268cee28f7cb358b4acc06b79f0a5c1a8f07c8a3d92897b42117bf7',
      policy: { kind: 'unanimous' },
      remaining: 'drain',
      next: choice.id,
    });
    expect(choice).toEqual({
      ...exactChoice(choice, parallel),
      id: 'sha256:6519dffd7a4ec877bd5193c52b3668a67542c497627a1e42c4c77605fd8fd633',
    });
    expect(result.requirements.entries).toEqual([
      {
        kind: 'agent',
        key: 'alpha-binding',
        bindingKey: 'alpha-binding',
        inputSchema: participantInputSchema,
        outputSchema: VoteValueSchema,
      },
      {
        kind: 'agent',
        key: 'equipe-binding',
        bindingKey: 'equipe-binding',
        inputSchema: participantInputSchema,
        outputSchema: VoteValueSchema,
      },
    ]);
    expect(result.provenance.requirements).toEqual([
      {
        requirementKey: 'alpha-binding',
        sourcePaths: ['/modules/0/region/nodes/0/participants/0'],
        materializationPaths: [],
      },
      {
        requirementKey: 'equipe-binding',
        sourcePaths: ['/modules/0/region/nodes/0/participants/1'],
        materializationPaths: [],
      },
    ]);
    expect(consensusProvenance(result)).toEqual(expectedConsensusProvenance(false));
  });

  it('emits complete slot-consensus topology and exact materialization paths', () => {
    const source = sourceForNode({
      ...consensusAgentNode(),
      input: parentParticipantInput,
      inputSchema: participantInputSchema,
    });
    const result = successful(
      source,
      materializationFor(source, {
        strategy: 'consensus',
        participants: [
          { key: 'équipe', bindingKey: 'equipe-binding' },
          { key: 'alpha', bindingKey: 'alpha-binding' },
        ],
      }),
    );
    const { parallel, choice, participants: topology } = voteTopology(result.program);

    expectParticipantContracts(topology);
    expect(topology.map(({ key, bindingKey, input }) => ({ key, bindingKey, input }))).toEqual([
      { key: 'alpha', bindingKey: 'alpha-binding', input: parentParticipantInput },
      { key: 'équipe', bindingKey: 'equipe-binding', input: parentParticipantInput },
    ]);
    expect(parallel).toEqual({
      kind: 'parallel',
      id: parallel.id,
      mode: 'votes',
      branches: parallel.branches,
      policy: { kind: 'unanimous' },
      remaining: 'drain',
      next: choice.id,
    });
    expect(choice).toEqual(exactChoice(choice, parallel));
    expect(result.requirements.entries).toEqual([
      {
        kind: 'agent',
        key: 'alpha-binding',
        bindingKey: 'alpha-binding',
        inputSchema: participantInputSchema,
        outputSchema: VoteValueSchema,
      },
      {
        kind: 'agent',
        key: 'equipe-binding',
        bindingKey: 'equipe-binding',
        inputSchema: participantInputSchema,
        outputSchema: VoteValueSchema,
      },
    ]);
    expect(result.provenance.requirements).toEqual([
      {
        requirementKey: 'alpha-binding',
        sourcePaths: ['/modules/0/region/nodes/0'],
        materializationPaths: ['/slots/0/selection/participants/0'],
      },
      {
        requirementKey: 'equipe-binding',
        sourcePaths: ['/modules/0/region/nodes/0'],
        materializationPaths: ['/slots/0/selection/participants/1'],
      },
    ]);
    expect(consensusProvenance(result)).toEqual(expectedConsensusProvenance(true));
  });
});
