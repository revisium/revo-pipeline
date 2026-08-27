import { Type, type Static } from 'typebox';

import {
  DigestSchema,
  JsonValueSchema,
  closedObject,
  readonlySchema,
} from '../../foundation/index.js';
import { CommandRefSchema } from './identity.js';

const operationEvent = {
  commandKey: readonlySchema(DigestSchema),
  ref: readonlySchema(CommandRefSchema),
};

export const PipelineEventSchema = Type.Union([
  closedObject({
    kind: readonlySchema(Type.Literal('activitySucceeded')),
    ...operationEvent,
    output: readonlySchema(JsonValueSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('activityFailed')),
    ...operationEvent,
    errorCode: readonlySchema(Type.String()),
  }),
  closedObject({ kind: readonlySchema(Type.Literal('activityCancelled')), ...operationEvent }),
  closedObject({ kind: readonlySchema(Type.Literal('waitCompleted')), ...operationEvent }),
  closedObject({
    kind: readonlySchema(Type.Literal('signalReceived')),
    ...operationEvent,
    signal: readonlySchema(Type.String()),
    payload: readonlySchema(Type.Union([JsonValueSchema, Type.Null()])),
  }),
  closedObject({ kind: readonlySchema(Type.Literal('waitCancelled')), ...operationEvent }),
  closedObject({
    kind: readonlySchema(Type.Literal('gateResolved')),
    ...operationEvent,
    resolution: readonlySchema(
      Type.Union([
        closedObject({
          kind: readonlySchema(Type.Literal('answer')),
          answer: readonlySchema(Type.String()),
          actorRef: readonlySchema(Type.String()),
          payload: readonlySchema(Type.Union([JsonValueSchema, Type.Null()])),
        }),
        closedObject({ kind: readonlySchema(Type.Literal('deadline')) }),
      ]),
    ),
  }),
  closedObject({ kind: readonlySchema(Type.Literal('gateCancelled')), ...operationEvent }),
  closedObject({
    kind: readonlySchema(Type.Literal('cancelRequested')),
    reasonCode: readonlySchema(Type.String()),
  }),
]);
export type PipelineEvent = Static<typeof PipelineEventSchema>;
