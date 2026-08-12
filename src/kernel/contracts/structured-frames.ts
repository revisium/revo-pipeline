import { Type, type Static } from 'typebox';

import {
  DigestSchema,
  JsonValueSchema,
  PIPELINE_LIMITS,
  closedObject,
  immutableArraySchema,
  readonlySchema,
} from '../../foundation/index.js';
import { PipelineFailureSchema } from './failure.js';
import { RegionTerminalResultSchema } from './results.js';
import { frameBaseProperties } from './schema-parts.js';

const structuredStatus = readonlySchema(
  Type.Union([
    Type.Literal('active'),
    Type.Literal('draining'),
    Type.Literal('cancelling'),
    Type.Literal('completed'),
  ]),
);

export const CallMachineFrameSchema = closedObject({
  ...frameBaseProperties,
  kind: readonlySchema(Type.Literal('call')),
  parentFrameKey: readonlySchema(DigestSchema),
  nodeId: readonlySchema(DigestSchema),
  childRegionKey: readonlySchema(Type.Union([DigestSchema, Type.Null()])),
  childResult: readonlySchema(Type.Union([RegionTerminalResultSchema, Type.Null()])),
  status: readonlySchema(Type.Union([Type.Literal('active'), Type.Literal('completed')])),
});
export type CallMachineFrame = Static<typeof CallMachineFrameSchema>;

const genericBranchResult = Type.Union([
  closedObject({
    status: readonlySchema(Type.Literal('completed')),
    outcome: readonlySchema(Type.String()),
    output: readonlySchema(JsonValueSchema),
  }),
  closedObject({
    status: readonlySchema(Type.Literal('failed')),
    failure: readonlySchema(PipelineFailureSchema),
  }),
  closedObject({ status: readonlySchema(Type.Literal('cancelled')) }),
]);

const voteBranchResult = Type.Union([
  closedObject({
    status: readonlySchema(Type.Literal('vote')),
    vote: readonlySchema(
      Type.Union([Type.Literal('approve'), Type.Literal('reject'), Type.Literal('abstain')]),
    ),
  }),
  closedObject({
    status: readonlySchema(Type.Literal('failed')),
    failure: readonlySchema(PipelineFailureSchema),
  }),
  closedObject({ status: readonlySchema(Type.Literal('cancelled')) }),
]);

const parallelBaseProperties = {
  ...frameBaseProperties,
  kind: readonlySchema(Type.Literal('parallel')),
  parentFrameKey: readonlySchema(DigestSchema),
  nodeId: readonlySchema(DigestSchema),
  branchRegionKeys: readonlySchema(
    Type.Record(Type.String(), DigestSchema, {
      maxProperties: PIPELINE_LIMITS.structured.participants,
    }),
  ),
  status: structuredStatus,
};

export const GenericParallelMachineFrameSchema = closedObject({
  ...parallelBaseProperties,
  mode: readonlySchema(Type.Literal('generic')),
  branchResults: readonlySchema(
    Type.Record(Type.String(), genericBranchResult, {
      maxProperties: PIPELINE_LIMITS.structured.participants,
    }),
  ),
  selected: readonlySchema(
    Type.Union([
      Type.Literal('completed'),
      Type.Literal('impossible'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
      Type.Null(),
    ]),
  ),
});
export type GenericParallelMachineFrame = Static<typeof GenericParallelMachineFrameSchema>;

export const VoteParallelMachineFrameSchema = closedObject({
  ...parallelBaseProperties,
  mode: readonlySchema(Type.Literal('votes')),
  branchResults: readonlySchema(
    Type.Record(Type.String(), voteBranchResult, {
      maxProperties: PIPELINE_LIMITS.structured.participants,
    }),
  ),
  selected: readonlySchema(
    Type.Union([
      Type.Literal('approved'),
      Type.Literal('rejected'),
      Type.Literal('inconclusive'),
      Type.Literal('participantFailed'),
      Type.Literal('cancelled'),
      Type.Null(),
    ]),
  ),
});
export type VoteParallelMachineFrame = Static<typeof VoteParallelMachineFrameSchema>;

export const ParallelMachineFrameSchema = Type.Union([
  GenericParallelMachineFrameSchema,
  VoteParallelMachineFrameSchema,
]);
export type ParallelMachineFrame = Static<typeof ParallelMachineFrameSchema>;

export type ParallelMachineFrameBase = Omit<
  GenericParallelMachineFrame,
  'mode' | 'branchResults' | 'selected'
>;

export const RepeatMachineFrameSchema = closedObject({
  ...frameBaseProperties,
  kind: readonlySchema(Type.Literal('repeat')),
  parentFrameKey: readonlySchema(DigestSchema),
  nodeId: readonlySchema(DigestSchema),
  iteration: readonlySchema(Type.Integer({ minimum: 0 })),
  bodyRegionKey: readonlySchema(Type.Union([DigestSchema, Type.Null()])),
  bodyResult: readonlySchema(Type.Union([RegionTerminalResultSchema, Type.Null()])),
  previousOutput: readonlySchema(Type.Union([JsonValueSchema, Type.Null()])),
  status: readonlySchema(Type.Union([Type.Literal('active'), Type.Literal('completed')])),
});
export type RepeatMachineFrame = Static<typeof RepeatMachineFrameSchema>;

export const MapItemResultSchema = closedObject({
  itemKey: readonlySchema(Type.String()),
  status: readonlySchema(
    Type.Union([Type.Literal('succeeded'), Type.Literal('failed'), Type.Literal('cancelled')]),
  ),
  output: readonlySchema(Type.Union([JsonValueSchema, Type.Null()])),
  failure: readonlySchema(Type.Union([PipelineFailureSchema, Type.Null()])),
});
export type MapItemResult = Static<typeof MapItemResultSchema>;

const mapKeys = () =>
  readonlySchema(immutableArraySchema(Type.String(), PIPELINE_LIMITS.structured.mapItems));

export const MapMachineFrameSchema = closedObject({
  ...frameBaseProperties,
  kind: readonlySchema(Type.Literal('map')),
  parentFrameKey: readonlySchema(DigestSchema),
  nodeId: readonlySchema(DigestSchema),
  itemKeys: mapKeys(),
  pendingItemKeys: mapKeys(),
  activeItemKeys: mapKeys(),
  completedItems: readonlySchema(
    immutableArraySchema(MapItemResultSchema, PIPELINE_LIMITS.structured.mapItems),
  ),
  status: structuredStatus,
  selected: readonlySchema(
    Type.Union([
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
      Type.Null(),
    ]),
  ),
});
export type MapMachineFrame = Static<typeof MapMachineFrameSchema>;
