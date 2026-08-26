import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import { EmptyObjectSchema, PipelineFailureValueSchema } from '../../../src/foundation/index.js';
import { createInitialPipelineState } from '../../../src/kernel/index.js';
import {
  ConsensusParticipantRegionOutputSchema,
  VoteExitSchema,
  VoteValueSchema,
} from '../../../src/program/index.js';
import type {
  PipelineSourcePackage,
  ValueMapping,
  ValueSchema,
} from '../../../src/source/index.js';
import { AgentActivityInputValueSchema } from '../../../src/source/index.js';
import { consensusAgentNode, materializationFor } from '../../support/compiler-builders.js';
import { consensusIdentityRecords } from '../../support/compiler-vectors.js';
import { sourceForNode, sourceNodeBuilders } from '../../support/source-builders.js';

const participantInputSchema = AgentActivityInputValueSchema;
const parentParticipantInput = {
  prompt: { kind: 'scopeInput', pointer: '/prompt' },
} as const;
const participantActivityInput = {
  prompt: { kind: 'scopeInput', pointer: '/prompt' },
} as const;
const agentParticipantInput = {
  prompt: { kind: 'scopeInput', pointer: '/prompt' },
} as const;
const metadataParticipantInputSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    metadata: {
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: { attempt: { type: 'integer', minimum: 2, maximum: 2 } },
          required: ['attempt'],
          additionalProperties: false,
        },
      },
      required: ['nested'],
      additionalProperties: false,
    },
  },
  required: ['prompt', 'metadata'],
  additionalProperties: false,
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
  inputSchema: ValueSchema = participantInputSchema,
  input: ValueMapping = participantActivityInput,
) => {
  for (const participant of participants) {
    expect(participant.region).toEqual({
      entry: participant.activity.id,
      inputSchema,
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
      input,
      inputSchema,
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
    sourceNodeId: 'activity',
    sourcePath: '/modules/0/region/nodes/0',
    materializationPath: materialized
      ? participantIndex === null
        ? '/activity'
        : `/activity/participants/${participantIndex}`
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
      input: { prompt: { kind: 'scopeInput', pointer: '/prompt' } },
      inputSchema: {
        type: 'object',
        properties: { prompt: { type: 'string' } },
        required: ['prompt'],
        additionalProperties: false,
      },
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

    expectParticipantContracts(
      topology,
      {
        type: 'object',
        properties: { prompt: { type: 'string' } },
        required: ['prompt'],
        additionalProperties: false,
      },
      agentParticipantInput,
    );
    expect(topology.map(({ key, bindingKey, input }) => ({ key, bindingKey, input }))).toEqual([
      {
        key: 'alpha',
        bindingKey: 'alpha-binding',
        input: agentParticipantInput,
      },
      {
        key: 'équipe',
        bindingKey: 'equipe-binding',
        input: agentParticipantInput,
      },
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
        inputSchema: {
          type: 'object',
          properties: { prompt: { type: 'string' } },
          required: ['prompt'],
          additionalProperties: false,
        },
        outputSchema: VoteValueSchema,
      },
      {
        kind: 'agent',
        key: 'equipe-binding',
        bindingKey: 'equipe-binding',
        inputSchema: {
          type: 'object',
          properties: { prompt: { type: 'string' } },
          required: ['prompt'],
          additionalProperties: false,
        },
        outputSchema: VoteValueSchema,
      },
    ]);
    expect(result.provenance.requirements).toEqual([
      {
        requirementKey: 'alpha-binding',
        sourcePaths: ['/modules/0/region/nodes/0'],
        materializationPaths: ['/activity/participants/0'],
      },
      {
        requirementKey: 'equipe-binding',
        sourcePaths: ['/modules/0/region/nodes/0'],
        materializationPaths: ['/activity/participants/1'],
      },
    ]);
    expect(consensusProvenance(result)).toEqual(expectedConsensusProvenance(true));
  });

  it('uses the fixed agent envelope for explicit-consensus participants', () => {
    const metadata = { nested: { attempt: 2 } };
    const consensus = sourceNodeBuilders.consensus();
    const source = sourceForNode({
      ...consensus,
      participants: [
        {
          ...consensus.participants[0],
          input: {
            prompt: { kind: 'scopeInput' as const, pointer: '/prompt' as const },
            metadata: { kind: 'literal' as const, value: metadata },
          },
          inputSchema: metadataParticipantInputSchema,
        },
        {
          ...consensus.participants[1],
          input: {
            prompt: { kind: 'scopeInput' as const, pointer: '/prompt' as const },
            metadata: { kind: 'literal' as const, value: metadata },
          },
          inputSchema: metadataParticipantInputSchema,
        },
      ],
    });
    const result = successful(source);
    const initial = createInitialPipelineState(
      { program: result.program, programDigest: result.programDigest },
      { prompt: 'Review this consensus.' },
    );

    expect(initial.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'dispatchActivity',
          input: { prompt: 'Review this consensus.', metadata },
        }),
      ]),
    );

    const invalid = sourceForNode({
      ...consensus,
      participants: [
        {
          ...consensus.participants[0],
          input: { request: { kind: 'literal' as const, value: 'review' } },
          inputSchema: {
            type: 'object' as const,
            properties: { request: { type: 'string' as const } },
            required: ['request'],
            additionalProperties: false,
          },
        },
        {
          ...consensus.participants[1],
          input: { request: { kind: 'literal' as const, value: 'review' } },
          inputSchema: {
            type: 'object' as const,
            properties: { request: { type: 'string' as const } },
            required: ['request'],
            additionalProperties: false,
          },
        },
      ],
    });
    expect(compilePipeline(invalid, materializationFor(invalid)).ok).toBe(false);
  });
});
