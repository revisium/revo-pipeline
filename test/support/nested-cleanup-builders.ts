import {
  EmptyObjectSchema,
  PipelineFailureValueSchema,
  type ValueSchema,
} from '../../src/foundation/index.js';
import type {
  ProgramActivityNode,
  ProgramEndNode,
  ProgramMapNode,
  ProgramParallelBranch,
  ProgramParallelNode,
  ProgramRegion,
  ProgramValueMapping,
  ProgramVoteBranch,
} from '../../src/program/index.js';
import {
  ConsensusParticipantRegionOutputSchema,
  VoteExitSchema,
  VoteValueSchema,
} from '../../src/program/index.js';
import { kernelModule, kernelProgram } from './kernel-builders.js';
import { structuredId } from './structured-kernel-builders.js';

const objectSchema = (properties: Readonly<Record<string, ValueSchema>>): ValueSchema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const end = (
  ordinal: number,
  outcome: string,
  output: ProgramValueMapping = {},
): ProgramEndNode => ({ kind: 'end', id: structuredId(ordinal), outcome, output });

const activityRegion = (
  base: number,
  requirementKey: string,
  output: ProgramValueMapping = {},
  outputSchema: ValueSchema = EmptyObjectSchema,
): ProgramRegion => {
  const terminal = end(base + 2, 'done', output);
  const activity: ProgramActivityNode = {
    kind: 'activity',
    id: structuredId(base + 1),
    activityKind: 'script',
    requirementKey,
    input: {},
    inputSchema: EmptyObjectSchema,
    outputSchema: EmptyObjectSchema,
    routes: { succeeded: terminal.id, failed: terminal.id, cancelled: terminal.id },
  };
  return {
    id: structuredId(base),
    inputSchema: EmptyObjectSchema,
    entry: activity.id,
    outputSchema,
    exits: [{ outcome: 'done', outputSchema }],
    nodes: [activity, terminal],
  };
};

const voteActivityRegion = (base: number, bindingKey: string): ProgramRegion => {
  const activityId = structuredId(base + 1);
  const cancelled = end(base + 2, 'cancelled');
  const failed = end(base + 3, 'failed', {
    code: { kind: 'nodeFailure', nodeId: activityId, pointer: '/code' },
    path: { kind: 'nodeFailure', nodeId: activityId, pointer: '/path' },
  });
  const vote = end(base + 4, 'vote', {
    vote: { kind: 'nodeOutput', nodeId: activityId, pointer: '' },
  });
  const activity: ProgramActivityNode = {
    kind: 'activity',
    id: activityId,
    activityKind: 'agent',
    requirementKey: bindingKey,
    input: {},
    inputSchema: EmptyObjectSchema,
    outputSchema: VoteValueSchema,
    routes: { succeeded: vote.id, failed: failed.id, cancelled: cancelled.id },
  };
  return {
    id: structuredId(base),
    inputSchema: EmptyObjectSchema,
    entry: activity.id,
    outputSchema: ConsensusParticipantRegionOutputSchema,
    exits: [
      { outcome: 'cancelled', outputSchema: EmptyObjectSchema },
      { outcome: 'failed', outputSchema: PipelineFailureValueSchema },
      { outcome: 'vote', outputSchema: VoteExitSchema },
    ],
    nodes: [activity, cancelled, failed, vote],
  };
};

const mapBody = (): ProgramRegion => {
  const activityId = structuredId(13_001);
  const cancelled = end(13_002, 'cancelled');
  const failed = end(13_003, 'failed', {
    code: { kind: 'nodeFailure', nodeId: activityId, pointer: '/code' },
    path: { kind: 'nodeFailure', nodeId: activityId, pointer: '/path' },
  });
  const succeeded = end(13_004, 'succeeded');
  const activity: ProgramActivityNode = {
    kind: 'activity',
    id: activityId,
    activityKind: 'script',
    requirementKey: 'nested-map-item',
    input: {},
    inputSchema: EmptyObjectSchema,
    outputSchema: EmptyObjectSchema,
    routes: { succeeded: succeeded.id, failed: failed.id, cancelled: cancelled.id },
  };
  return {
    id: structuredId(13_000),
    inputSchema: objectSchema({ id: { type: 'string' } }),
    entry: activity.id,
    outputSchema: { anyOf: [EmptyObjectSchema, PipelineFailureValueSchema] },
    exits: [
      { outcome: 'cancelled', outputSchema: EmptyObjectSchema },
      { outcome: 'failed', outputSchema: PipelineFailureValueSchema },
      { outcome: 'succeeded', outputSchema: EmptyObjectSchema },
    ],
    nodes: [activity, cancelled, failed, succeeded],
  };
};

const selectedMapRegion = (): ProgramRegion => {
  const map: ProgramMapNode = {
    kind: 'map',
    id: structuredId(12_001),
    items: { kind: 'literal', value: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    itemKeyPointer: '/id',
    maximumItems: 3,
    maximumConcurrency: 3,
    bodyInput: { id: { kind: 'map', value: 'item', pointer: '/id' } },
    body: mapBody(),
    bodyExits: [
      { outcome: 'cancelled', classification: 'cancelled' },
      { outcome: 'failed', classification: 'failed' },
      { outcome: 'succeeded', classification: 'completed' },
    ],
    failure: { kind: 'failFast', remaining: 'drain' },
    routes: {
      completed: structuredId(12_002),
      failed: structuredId(12_003),
      cancelled: structuredId(12_004),
    },
  };
  const completed = end(12_002, 'completed');
  const failed = end(12_003, 'failed', {
    code: { kind: 'nodeFailure', nodeId: map.id, pointer: '/code' },
    path: { kind: 'nodeFailure', nodeId: map.id, pointer: '/path' },
  });
  const cancelled = end(12_004, 'cancelled');
  return {
    id: structuredId(12_000),
    inputSchema: EmptyObjectSchema,
    entry: map.id,
    outputSchema: { anyOf: [EmptyObjectSchema, PipelineFailureValueSchema] },
    exits: [
      { outcome: 'cancelled', outputSchema: EmptyObjectSchema },
      { outcome: 'completed', outputSchema: EmptyObjectSchema },
      { outcome: 'failed', outputSchema: PipelineFailureValueSchema },
    ],
    nodes: [map, completed, failed, cancelled],
  };
};

const outerProgram = (right: ProgramParallelBranch, base: number) => {
  const winner: ProgramParallelBranch = {
    key: 'winner',
    input: {},
    region: activityRegion(base + 100, 'outer-winner'),
    exits: [{ outcome: 'done', classification: 'qualifies' }],
  };
  const terminal = end(base + 2, 'done');
  const parallel: ProgramParallelNode = {
    kind: 'parallel',
    id: structuredId(base + 1),
    mode: 'generic',
    branches: [right, winner],
    policy: { kind: 'any' },
    remaining: 'cancel',
    next: terminal.id,
  };
  const main: ProgramRegion = {
    id: structuredId(base),
    inputSchema: EmptyObjectSchema,
    entry: parallel.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'done', outputSchema: EmptyObjectSchema }],
    nodes: [parallel, terminal],
  };
  return kernelProgram([kernelModule('main', main)]);
};

export const nestedSelectedMapCancellationProgram = () =>
  outerProgram(
    {
      key: 'nested',
      input: {},
      region: selectedMapRegion(),
      exits: [
        { outcome: 'cancelled', classification: 'cancelled' },
        { outcome: 'completed', classification: 'qualifies' },
        { outcome: 'failed', classification: 'failed' },
      ],
    },
    10_000,
  );

const selectedParallelRegion = (mode: 'generic' | 'votes'): ProgramRegion => {
  const branch = (key: string, index: number) => ({
    key,
    bindingKey: `binding-${key}`,
    input: {},
    region:
      mode === 'votes'
        ? voteActivityRegion(23_000 + index * 100, `binding-${key}`)
        : activityRegion(23_000 + index * 100, `nested-parallel-${key}`),
  });
  const branches = [branch('a', 0), branch('b', 1), branch('c', 2)] as const;
  const genericBranch = (value: (typeof branches)[number]): ProgramParallelBranch => ({
    key: value.key,
    input: value.input,
    region: value.region,
    exits: [{ outcome: 'done', classification: 'qualifies' }],
  });
  const parallel: ProgramParallelNode =
    mode === 'votes'
      ? {
          kind: 'parallel',
          id: structuredId(22_001),
          mode,
          branches: branches satisfies readonly [
            ProgramVoteBranch,
            ProgramVoteBranch,
            ProgramVoteBranch,
          ],
          policy: { kind: 'independentThreshold', approveThreshold: 1, rejectThreshold: 3 },
          remaining: 'drain',
          next: structuredId(22_002),
        }
      : {
          kind: 'parallel',
          id: structuredId(22_001),
          mode,
          branches: [
            genericBranch(branches[0]),
            genericBranch(branches[1]),
            genericBranch(branches[2]),
          ],
          policy: { kind: 'any' },
          remaining: 'drain',
          next: structuredId(22_002),
        };
  const terminal = end(22_002, 'done');
  return {
    id: structuredId(22_000),
    inputSchema: EmptyObjectSchema,
    entry: parallel.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'done', outputSchema: EmptyObjectSchema }],
    nodes: [parallel, terminal],
  };
};

export const nestedSelectedParallelCancellationProgram = (mode: 'generic' | 'votes') =>
  outerProgram(
    {
      key: 'nested',
      input: {},
      region: selectedParallelRegion(mode),
      exits: [{ outcome: 'done', classification: 'qualifies' }],
    },
    20_000,
  );
