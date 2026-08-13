import { EmptyObjectSchema, PipelineFailureValueSchema } from '../../src/foundation/index.js';
import {
  ConsensusParticipantRegionOutputSchema,
  VoteExitSchema,
  VoteValueSchema,
  type ProgramActivityNode,
  type ProgramEndNode,
  type ProgramParallelNode,
  type ProgramRegion,
  type ProgramValueMapping,
} from '../../src/program/index.js';
import { kernelModule, kernelProgram } from './kernel-builders.js';
import { structuredId } from './structured-kernel-builders.js';

const end = (
  ordinal: number,
  outcome: string,
  output: ProgramValueMapping = {},
): ProgramEndNode => ({ kind: 'end', id: structuredId(ordinal), outcome, output });

const genericRegion = (base: number): ProgramRegion => {
  const activityId = structuredId(base + 1);
  const cancelled = end(base + 2, 'cancelled');
  const failed = end(base + 3, 'failed', {
    code: { kind: 'nodeFailure', nodeId: activityId, pointer: '/code' },
    path: { kind: 'nodeFailure', nodeId: activityId, pointer: '/path' },
  });
  const succeeded = end(base + 4, 'succeeded');
  const activity: ProgramActivityNode = {
    kind: 'activity',
    id: activityId,
    activityKind: 'script',
    requirementKey: `generic-${base}`,
    input: {},
    inputSchema: EmptyObjectSchema,
    outputSchema: EmptyObjectSchema,
    routes: { succeeded: succeeded.id, failed: failed.id, cancelled: cancelled.id },
  };
  return {
    id: structuredId(base),
    inputSchema: EmptyObjectSchema,
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

const voteRegion = (base: number, bindingKey: string): ProgramRegion => {
  const activityId = structuredId(base + 1);
  const cancelled = end(base + 2, 'cancelled');
  const failed = end(base + 3, 'failed', {
    code: { kind: 'nodeFailure', nodeId: activityId, pointer: '/code' },
    path: { kind: 'nodeFailure', nodeId: activityId, pointer: '/path' },
  });
  const voted = end(base + 4, 'vote', {
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
    routes: { succeeded: voted.id, failed: failed.id, cancelled: cancelled.id },
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
    nodes: [activity, cancelled, failed, voted],
  };
};

const genericExits = [
  { outcome: 'cancelled', classification: 'cancelled' as const },
  { outcome: 'failed', classification: 'failed' as const },
  { outcome: 'succeeded', classification: 'qualifies' as const },
] as const;

export const unstartedParallelProgram = (mode: 'generic' | 'votes') => {
  const keys = ['__proto__', 'live', 'winner'] as const;
  const regions = keys.map((unusedKey, index) =>
    mode === 'generic'
      ? genericRegion(1_000 + index * 10)
      : voteRegion(1_000 + index * 10, keys[index]!),
  );
  const parallel: ProgramParallelNode =
    mode === 'generic'
      ? {
          kind: 'parallel',
          id: structuredId(900),
          mode,
          branches: [
            { key: keys[0], input: {}, region: regions[0]!, exits: genericExits },
            { key: keys[1], input: {}, region: regions[1]!, exits: genericExits },
            { key: keys[2], input: {}, region: regions[2]!, exits: genericExits },
          ],
          policy: { kind: 'any' },
          remaining: 'cancel',
          next: structuredId(901),
        }
      : {
          kind: 'parallel',
          id: structuredId(900),
          mode,
          branches: [
            {
              key: keys[0],
              bindingKey: keys[0],
              input: {},
              region: regions[0]!,
            },
            {
              key: keys[1],
              bindingKey: keys[1],
              input: {},
              region: regions[1]!,
            },
            {
              key: keys[2],
              bindingKey: keys[2],
              input: {},
              region: regions[2]!,
            },
          ],
          policy: { kind: 'independentThreshold', approveThreshold: 1, rejectThreshold: 3 },
          remaining: 'cancel',
          next: structuredId(901),
        };
  const terminal = end(901, 'done');
  const region: ProgramRegion = {
    id: structuredId(899),
    inputSchema: EmptyObjectSchema,
    entry: parallel.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'done', outputSchema: EmptyObjectSchema }],
    nodes: [parallel, terminal],
  };
  return kernelProgram([kernelModule('main', region)]);
};
