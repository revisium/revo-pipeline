import { Type, type Static } from 'typebox';

import {
  PIPELINE_LIMITS,
  closedObject,
  immutableArraySchema,
  nonEmptyArraySchema,
  readonlySchema,
} from '../../foundation/index.js';
import { PipelineCommandSchema } from './commands.js';
import { MachineFaultSchema } from './faults.js';
import { PipelineStateSchema } from './state.js';

const commands = readonlySchema(
  immutableArraySchema(PipelineCommandSchema, PIPELINE_LIMITS.sourcePackage.totalActivities),
);

export const InitialPipelineTransitionSchema = closedObject({
  kind: readonlySchema(Type.Literal('initialized')),
  state: readonlySchema(PipelineStateSchema),
  commands,
});
export type InitialPipelineTransition = Static<typeof InitialPipelineTransitionSchema>;

export const PipelineTransitionSchema = Type.Union([
  closedObject({
    kind: readonlySchema(Type.Literal('advanced')),
    state: readonlySchema(PipelineStateSchema),
    commands,
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('rejected')),
    state: readonlySchema(PipelineStateSchema),
    commands: readonlySchema(Type.Tuple([])),
    faults: readonlySchema(nonEmptyArraySchema(MachineFaultSchema)),
  }),
]);
export type PipelineTransition = Static<typeof PipelineTransitionSchema>;
