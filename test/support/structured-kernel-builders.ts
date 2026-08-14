import {
  EmptyObjectSchema,
  PipelineFailureValueSchema,
  type Digest,
  type ValueSchema,
} from '../../src/foundation/index.js';
import type {
  ProgramActivityNode,
  ProgramEndNode,
  ProgramMapNode,
  ProgramNode,
  ProgramNodeId,
  ProgramParallelNode,
  ProgramParallelBranch,
  ProgramRegion,
  ProgramRepeatCondition,
  ProgramValueMapping,
} from '../../src/program/index.js';
import { kernelModule, kernelProgram } from './kernel-builders.js';

export const structuredId = (ordinal: number): ProgramNodeId =>
  `sha256:${ordinal.toString(16).padStart(64, '0')}`;

const objectSchema = (properties: Readonly<Record<string, ValueSchema>>): ValueSchema =>
  Object.freeze({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });

const end = (
  id: ProgramNodeId,
  outcome: string,
  output: ProgramEndNode['output'],
): ProgramEndNode => Object.freeze({ kind: 'end', id, outcome, output });

const stringLiteralUnion = (values: readonly string[]): ValueSchema => {
  const alternatives = values.map((value) => ({
    type: 'string' as const,
    enum: [value] as readonly [string],
  }));
  const [first, second, ...remaining] = alternatives;
  if (first === undefined) {
    throw new TypeError('Expected at least one map item key.');
  }
  return second === undefined ? first : { anyOf: [first, second, ...remaining] };
};

const mapBody = (idSchema: ValueSchema): ProgramRegion => {
  const activityId = structuredId(101);
  const cancelled = end(structuredId(102), 'cancelled', {});
  const failed = end(structuredId(103), 'failed', {
    code: { kind: 'nodeFailure', nodeId: activityId, pointer: '/code' },
    path: { kind: 'nodeFailure', nodeId: activityId, pointer: '/path' },
  });
  const succeeded = end(structuredId(104), 'succeeded', {});
  const activity: ProgramNode = {
    kind: 'activity',
    id: activityId,
    activityKind: 'script',
    requirementKey: 'map-work',
    input: {},
    inputSchema: EmptyObjectSchema,
    outputSchema: EmptyObjectSchema,
    routes: {
      succeeded: succeeded.id,
      failed: failed.id,
      cancelled: cancelled.id,
    },
  };
  return {
    id: structuredId(100),
    inputSchema: objectSchema({ id: idSchema }),
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

const activityRegion = (base: number): ProgramRegion => {
  const activityId = structuredId(base + 1);
  const cancelled = end(structuredId(base + 2), 'cancelled', {});
  const failed = end(structuredId(base + 3), 'failed', {
    code: { kind: 'nodeFailure', nodeId: activityId, pointer: '/code' },
    path: { kind: 'nodeFailure', nodeId: activityId, pointer: '/path' },
  });
  const succeeded = end(structuredId(base + 4), 'succeeded', {});
  const activity: ProgramActivityNode = {
    kind: 'activity',
    id: activityId,
    activityKind: 'script',
    requirementKey: `branch-${base}`,
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

export const parallelActivityProgram = (
  remaining: 'drain' | 'cancel',
  policy: Extract<ProgramParallelNode, { readonly mode: 'generic' }>['policy'] = { kind: 'all' },
  leftInput: ProgramValueMapping = {},
  branchKeys: readonly [string, string] = ['left', 'right'],
) => {
  const parallel: ProgramParallelNode = {
    kind: 'parallel',
    id: structuredId(1),
    mode: 'generic',
    branches: [
      {
        key: branchKeys[0],
        input: leftInput,
        region: activityRegion(200),
        exits: [
          { outcome: 'cancelled', classification: 'cancelled' },
          { outcome: 'failed', classification: 'failed' },
          { outcome: 'succeeded', classification: 'qualifies' },
        ],
      },
      {
        key: branchKeys[1],
        input: {},
        region: activityRegion(300),
        exits: [
          { outcome: 'cancelled', classification: 'cancelled' },
          { outcome: 'failed', classification: 'failed' },
          { outcome: 'succeeded', classification: 'qualifies' },
        ],
      },
    ],
    policy,
    remaining,
    next: structuredId(2),
  };
  const completed = end(structuredId(2), 'ok', {});
  const region: ProgramRegion = {
    id: structuredId(10),
    inputSchema: EmptyObjectSchema,
    entry: parallel.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'ok', outputSchema: EmptyObjectSchema }],
    nodes: [parallel, completed],
  };
  return kernelProgram([kernelModule('main', region)]);
};

export const synchronousParallelProgram = (
  policy: Extract<ProgramParallelNode, { readonly mode: 'generic' }>['policy'],
) => {
  const branch = (base: number): ProgramRegion => {
    const terminal = end(structuredId(base + 1), 'done', {});
    return {
      id: structuredId(base),
      inputSchema: EmptyObjectSchema,
      entry: terminal.id,
      outputSchema: EmptyObjectSchema,
      exits: [{ outcome: 'done', outputSchema: EmptyObjectSchema }],
      nodes: [terminal],
    };
  };
  const parallel: ProgramParallelNode = {
    kind: 'parallel',
    id: structuredId(1),
    mode: 'generic',
    branches: [
      {
        key: 'a',
        input: {},
        region: branch(500),
        exits: [{ outcome: 'done', classification: 'qualifies' }],
      },
      {
        key: 'z',
        input: {},
        region: branch(510),
        exits: [{ outcome: 'done', classification: 'qualifies' }],
      },
    ] satisfies [ProgramParallelBranch, ProgramParallelBranch],
    policy,
    remaining: 'cancel',
    next: structuredId(2),
  };
  const completed = end(structuredId(2), 'ok', {});
  const region: ProgramRegion = {
    id: structuredId(10),
    inputSchema: EmptyObjectSchema,
    entry: parallel.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'ok', outputSchema: EmptyObjectSchema }],
    nodes: [parallel, completed],
  };
  return kernelProgram([kernelModule('main', region)]);
};

export const repeatActivityProgram = (options: {
  readonly condition: ProgramRepeatCondition;
  readonly nextInput?: ProgramValueMapping;
  readonly output?: ProgramValueMapping;
}) => {
  const repeat: ProgramNode = {
    kind: 'repeat',
    id: structuredId(1),
    maximumIterations: 2,
    initialInput: {},
    nextInput: options.nextInput ?? {},
    body: activityRegion(400),
    bodyExits: [
      { outcome: 'cancelled', classification: 'cancelled' },
      { outcome: 'failed', classification: 'failed' },
      { outcome: 'succeeded', classification: 'value' },
    ],
    continueWhen: options.condition,
    output: options.output ?? {},
    outputSchema: EmptyObjectSchema,
    routes: {
      completed: structuredId(2),
      exhausted: structuredId(3),
      failed: structuredId(4),
      cancelled: structuredId(5),
    },
  };
  const region: ProgramRegion = {
    id: structuredId(10),
    inputSchema: EmptyObjectSchema,
    entry: repeat.id,
    outputSchema: EmptyObjectSchema,
    exits: [
      { outcome: 'cancelled', outputSchema: EmptyObjectSchema },
      { outcome: 'completed', outputSchema: EmptyObjectSchema },
      { outcome: 'exhausted', outputSchema: EmptyObjectSchema },
      { outcome: 'failed', outputSchema: EmptyObjectSchema },
    ],
    nodes: [
      repeat,
      end(structuredId(2), 'completed', {}),
      end(structuredId(3), 'exhausted', {}),
      end(structuredId(4), 'failed', {}),
      end(structuredId(5), 'cancelled', {}),
    ],
  };
  return kernelProgram([kernelModule('main', region)]);
};

const mapNode = (remaining: 'drain' | 'cancel'): ProgramMapNode => {
  const values = [{ id: 'z' }, { id: 'a' }] as const;
  return {
    kind: 'map',
    id: structuredId(1),
    items: { kind: 'literal', value: values },
    itemKeyPointer: '/id',
    maximumItems: 2,
    maximumConcurrency: 2,
    bodyInput: { id: { kind: 'map', value: 'item', pointer: '/id' } },
    body: mapBody(stringLiteralUnion(values.map(({ id }) => id))),
    bodyExits: [
      { outcome: 'cancelled', classification: 'cancelled' },
      { outcome: 'failed', classification: 'failed' },
      { outcome: 'succeeded', classification: 'completed' },
    ],
    failure: { kind: 'failFast', remaining },
    routes: {
      completed: structuredId(2),
      failed: structuredId(3),
      cancelled: structuredId(4),
    },
  };
};

export const failFastMapProgram = (remaining: 'drain' | 'cancel') => {
  const map = mapNode(remaining);
  const completed = end(structuredId(2), 'ok', {});
  const failed = end(structuredId(3), 'failed', {
    code: { kind: 'nodeFailure', nodeId: map.id, pointer: '/code' },
    path: { kind: 'nodeFailure', nodeId: map.id, pointer: '/path' },
  });
  const cancelled = end(structuredId(4), 'cancelled', {});
  const region: ProgramRegion = {
    id: structuredId(10),
    inputSchema: EmptyObjectSchema,
    entry: map.id,
    outputSchema: { anyOf: [EmptyObjectSchema, PipelineFailureValueSchema] },
    exits: [
      { outcome: 'cancelled', outputSchema: EmptyObjectSchema },
      { outcome: 'failed', outputSchema: PipelineFailureValueSchema },
      { outcome: 'ok', outputSchema: EmptyObjectSchema },
    ],
    nodes: [map, completed, failed, cancelled],
  };
  return kernelProgram([kernelModule('main', region, EmptyObjectSchema, region.outputSchema)]);
};

export const activityMapProgram = (
  failure: ProgramMapNode['failure'],
  maximumConcurrency = 1,
  itemCount = 2,
) => {
  const base = mapNode('drain');
  const values =
    itemCount === 2
      ? ([{ id: 'z' }, { id: 'a' }] as const)
      : Array.from({ length: itemCount }, (_, ordinal) => ({
          id: `item-${String(ordinal).padStart(4, '0')}`,
        }));
  const map: ProgramMapNode = {
    ...base,
    items: { kind: 'literal', value: values },
    body: mapBody(stringLiteralUnion(values.map(({ id }) => id))),
    maximumItems: itemCount,
    maximumConcurrency,
    failure,
  };
  const completed = end(structuredId(2), 'ok', {});
  const failed = end(structuredId(3), 'failed', {});
  const cancelled = end(structuredId(4), 'cancelled', {});
  const region: ProgramRegion = {
    id: structuredId(10),
    inputSchema: EmptyObjectSchema,
    entry: map.id,
    outputSchema: EmptyObjectSchema,
    exits: [
      { outcome: 'cancelled', outputSchema: EmptyObjectSchema },
      { outcome: 'failed', outputSchema: EmptyObjectSchema },
      { outcome: 'ok', outputSchema: EmptyObjectSchema },
    ],
    nodes: [map, completed, failed, cancelled],
  };
  return kernelProgram([kernelModule('main', region)]);
};

export const commandForItem = (
  state: {
    readonly frames: readonly {
      readonly key: Digest;
      readonly kind: string;
      readonly itemKey?: string;
    }[];
  },
  commands: readonly {
    readonly kind: string;
    readonly key: Digest;
    readonly ref: { readonly frameKey: Digest };
  }[],
  itemKey: string,
) => {
  const frame = state.frames.find(
    (candidate) => candidate.kind === 'mapItem' && candidate.itemKey === itemKey,
  );
  const command = commands.find(
    (candidate) => candidate.kind === 'dispatchActivity' && candidate.ref.frameKey === frame?.key,
  );
  if (command === undefined) {
    throw new TypeError(`Expected dispatch for map item ${itemKey}.`);
  }
  return command;
};
