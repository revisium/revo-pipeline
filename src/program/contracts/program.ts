import { Type, type Static } from 'typebox';

import {
  DigestSchema,
  IdentifierSchema,
  PIPELINE_LIMITS,
  ValueSchemaSchema,
  closedObject,
  nonEmptyArraySchema,
  readonlySchema,
} from '../../foundation/index.js';
import { ProgramRegionSchema } from './nodes.js';

export const ProgramModuleSchema = closedObject({
  key: readonlySchema(IdentifierSchema),
  inputSchema: readonlySchema(ValueSchemaSchema),
  outputSchema: readonlySchema(ValueSchemaSchema),
  region: readonlySchema(ProgramRegionSchema),
});
export type ProgramModule = Static<typeof ProgramModuleSchema>;

export const PipelineProgramSchema = closedObject({
  schemaVersion: readonlySchema(Type.Literal('pipeline-program/v1')),
  key: readonlySchema(IdentifierSchema),
  sourceDigest: readonlySchema(DigestSchema),
  materializationDigest: readonlySchema(DigestSchema),
  entryModule: readonlySchema(IdentifierSchema),
  maximumTotalActivities: readonlySchema(
    Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.sourcePackage.totalActivities }),
  ),
  modules: readonlySchema(
    nonEmptyArraySchema(ProgramModuleSchema, PIPELINE_LIMITS.sourcePackage.modules),
  ),
});
export type PipelineProgram = Static<typeof PipelineProgramSchema>;
