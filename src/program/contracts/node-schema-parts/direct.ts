import { Type } from 'typebox';

import {
  ChoiceDomainSchema,
  DisplayStringSchema,
  IdentifierSchema,
  ValueSchemaSchema,
  closedObject,
  immutableArraySchema,
  nonEmptyArraySchema,
  readonlySchema,
} from '../../../foundation/index.js';
import { ProgramValueMappingSchema, ProgramValueSelectorSchema } from '../selectors.js';
import { ProgramNodeIdSchema, targetRoutes } from './common.js';

export const directNodeSchemas = {
  ProgramActivityNode: closedObject({
    kind: readonlySchema(Type.Literal('activity')),
    id: readonlySchema(ProgramNodeIdSchema),
    activityKind: readonlySchema(Type.Union([Type.Literal('agent'), Type.Literal('script')])),
    requirementKey: readonlySchema(IdentifierSchema),
    input: readonlySchema(ProgramValueMappingSchema),
    inputSchema: readonlySchema(ValueSchemaSchema),
    outputSchema: readonlySchema(ValueSchemaSchema),
    routes: readonlySchema(targetRoutes(['succeeded', 'failed', 'cancelled'])),
  }),
  ProgramChoiceNode: closedObject({
    kind: readonlySchema(Type.Literal('choice')),
    id: readonlySchema(ProgramNodeIdSchema),
    selector: readonlySchema(ProgramValueSelectorSchema),
    cases: readonlySchema(
      nonEmptyArraySchema(
        closedObject({
          key: readonlySchema(IdentifierSchema),
          when: readonlySchema(ChoiceDomainSchema),
          target: readonlySchema(ProgramNodeIdSchema),
        }),
      ),
    ),
    otherwise: readonlySchema(Type.Union([ProgramNodeIdSchema, Type.Null()])),
  }),
  ProgramCallNode: closedObject({
    kind: readonlySchema(Type.Literal('call')),
    id: readonlySchema(ProgramNodeIdSchema),
    module: readonlySchema(IdentifierSchema),
    input: readonlySchema(ProgramValueMappingSchema),
    outputSchema: readonlySchema(ValueSchemaSchema),
    routes: readonlySchema(
      closedObject({
        outcomes: readonlySchema(
          nonEmptyArraySchema(
            closedObject({
              outcome: readonlySchema(IdentifierSchema),
              target: readonlySchema(ProgramNodeIdSchema),
            }),
          ),
        ),
        failed: readonlySchema(ProgramNodeIdSchema),
        cancelled: readonlySchema(ProgramNodeIdSchema),
      }),
    ),
  }),
  ProgramWaitNode: closedObject({
    kind: readonlySchema(Type.Literal('wait')),
    id: readonlySchema(ProgramNodeIdSchema),
    wait: readonlySchema(
      Type.Union([
        closedObject({
          kind: readonlySchema(Type.Literal('duration')),
          durationMs: readonlySchema(Type.Integer({ minimum: 0 })),
        }),
        closedObject({
          kind: readonlySchema(Type.Literal('signal')),
          signal: readonlySchema(IdentifierSchema),
          payloadSchema: readonlySchema(Type.Union([ValueSchemaSchema, Type.Null()])),
        }),
      ]),
    ),
    routes: readonlySchema(targetRoutes(['completed', 'cancelled'])),
  }),
  ProgramHumanGateNode: closedObject({
    kind: readonlySchema(Type.Literal('humanGate')),
    id: readonlySchema(ProgramNodeIdSchema),
    subject: readonlySchema(DisplayStringSchema),
    answers: readonlySchema(nonEmptyArraySchema(IdentifierSchema)),
    authorizationRequirements: readonlySchema(immutableArraySchema(IdentifierSchema)),
    payloadSchema: readonlySchema(Type.Union([ValueSchemaSchema, Type.Null()])),
    deadline: readonlySchema(
      Type.Union([
        closedObject({
          afterMs: readonlySchema(Type.Integer({ minimum: 0 })),
          target: readonlySchema(ProgramNodeIdSchema),
        }),
        Type.Null(),
      ]),
    ),
    routes: readonlySchema(
      closedObject({
        answers: readonlySchema(
          nonEmptyArraySchema(
            closedObject({
              answer: readonlySchema(IdentifierSchema),
              target: readonlySchema(ProgramNodeIdSchema),
            }),
          ),
        ),
        cancelled: readonlySchema(ProgramNodeIdSchema),
      }),
    ),
  }),
  ProgramEndNode: closedObject({
    kind: readonlySchema(Type.Literal('end')),
    id: readonlySchema(ProgramNodeIdSchema),
    outcome: readonlySchema(IdentifierSchema),
    output: readonlySchema(ProgramValueMappingSchema),
  }),
};

export { ProgramRepeatConditionSchema } from '../selectors.js';
