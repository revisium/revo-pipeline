import { Type, type Static } from 'typebox';

import {
  DigestSchema,
  JsonPointerSchema,
  JsonValueSchema,
  PIPELINE_LIMITS,
  ValueSchemaSchema,
  closedObject,
  immutableArraySchema,
  nonEmptyArraySchema,
  readonlySchema,
} from '../../foundation/index.js';
import { CommandRefSchema } from './identity.js';

const command = {
  key: readonlySchema(DigestSchema),
  ref: readonlySchema(CommandRefSchema),
};

export const PipelineCommandSchema = Type.Union([
  closedObject({
    kind: readonlySchema(Type.Literal('cancelPending')),
    ...command,
    targets: readonlySchema(
      nonEmptyArraySchema(DigestSchema, PIPELINE_LIMITS.machine.liveOperations),
    ),
    reasonCode: readonlySchema(Type.String()),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('dispatchActivity')),
    ...command,
    requirementKey: readonlySchema(Type.String()),
    input: readonlySchema(JsonValueSchema),
    outputSchema: readonlySchema(ValueSchemaSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('scheduleWait')),
    ...command,
    wait: readonlySchema(
      Type.Union([
        closedObject({
          kind: readonlySchema(Type.Literal('duration')),
          durationMs: readonlySchema(Type.Integer({ minimum: 0 })),
        }),
        closedObject({
          kind: readonlySchema(Type.Literal('signal')),
          signal: readonlySchema(Type.String()),
          payloadSchema: readonlySchema(Type.Union([ValueSchemaSchema, Type.Null()])),
        }),
      ]),
    ),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('openHumanGate')),
    ...command,
    subject: readonlySchema(Type.String()),
    answers: readonlySchema(nonEmptyArraySchema(Type.String())),
    authorizationRequirements: readonlySchema(immutableArraySchema(Type.String())),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('complete')),
    ...command,
    outcome: readonlySchema(Type.String()),
    output: readonlySchema(JsonValueSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('fail')),
    ...command,
    code: readonlySchema(Type.String()),
    path: readonlySchema(JsonPointerSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('cancel')),
    ...command,
    reasonCode: readonlySchema(Type.String()),
  }),
]);
export type PipelineCommand = Static<typeof PipelineCommandSchema>;
