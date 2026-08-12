import { Type, type Static } from 'typebox';

import { JsonValueSchema, closedObject, readonlySchema } from '../../foundation/index.js';
import { PipelineFailureSchema } from './failure.js';

export const NodeTerminalResultSchema = Type.Union([
  closedObject({
    status: readonlySchema(Type.Literal('succeeded')),
    output: readonlySchema(JsonValueSchema),
  }),
  closedObject({
    status: readonlySchema(Type.Literal('failed')),
    failure: readonlySchema(PipelineFailureSchema),
  }),
  closedObject({ status: readonlySchema(Type.Literal('cancelled')) }),
]);
export type NodeTerminalResult = Static<typeof NodeTerminalResultSchema>;

export const RegionTerminalResultSchema = Type.Union([
  closedObject({
    status: readonlySchema(Type.Literal('succeeded')),
    outcome: readonlySchema(Type.String()),
    output: readonlySchema(JsonValueSchema),
  }),
  closedObject({
    status: readonlySchema(Type.Literal('failed')),
    failure: readonlySchema(PipelineFailureSchema),
  }),
  closedObject({ status: readonlySchema(Type.Literal('cancelled')) }),
]);
export type RegionTerminalResult = Static<typeof RegionTerminalResultSchema>;
