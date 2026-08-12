import { Type, type Static } from 'typebox';

import { DigestSchema, closedObject, readonlySchema, type Digest } from '../../foundation/index.js';

const parentFrameKey = readonlySchema(DigestSchema);
const nodeId = readonlySchema(DigestSchema);

export const FrameKeyPayloadSchema = Type.Union([
  closedObject({
    kind: readonlySchema(Type.Literal('initialization')),
    parentFrameKey: readonlySchema(Type.Null()),
    programDigest: readonlySchema(Type.Union([DigestSchema, Type.Null()])),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('rootRegion')),
    parentFrameKey: readonlySchema(Type.Null()),
    regionId: nodeId,
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('call')),
    parentFrameKey,
    nodeId,
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('callRegion')),
    parentFrameKey,
    regionId: nodeId,
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('parallel')),
    parentFrameKey,
    nodeId,
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('parallelBranch')),
    parentFrameKey,
    regionId: nodeId,
    branchKey: readonlySchema(Type.String()),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('repeat')),
    parentFrameKey,
    nodeId,
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('repeatBody')),
    parentFrameKey,
    regionId: nodeId,
    ordinal: readonlySchema(Type.Integer({ minimum: 0 })),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('map')),
    parentFrameKey,
    nodeId,
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('mapItem')),
    parentFrameKey,
    regionId: nodeId,
    itemKey: readonlySchema(Type.String()),
  }),
]);
export type FrameKeyPayload = Static<typeof FrameKeyPayloadSchema>;

export const CommandRefSchema = closedObject({
  programDigest: readonlySchema(DigestSchema),
  frameKey: readonlySchema(DigestSchema),
  nodeId: readonlySchema(Type.Union([DigestSchema, Type.Literal('$pipeline')])),
});
export type CommandRef = Static<typeof CommandRefSchema>;
export type CommandKey = Digest;
