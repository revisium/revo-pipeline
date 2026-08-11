import { Type, type Static } from 'typebox';

import { PIPELINE_LIMITS, closedObject } from '../../foundation/index.js';
import { SourceRegionSchema, type SourceRegion } from './node-schemas.js';
import { IdentifierSchema, nonEmptyArraySchema, readonlySchema } from './schema-builders.js';
import { ValueSchemaSchema, type ValueSchema } from './value-contracts.js';

type ExactPipelineSourceModule = {
  readonly key: string;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
  readonly region: SourceRegion;
};

export const PipelineSourceModuleSchema = Type.Unsafe<ExactPipelineSourceModule>(
  closedObject({
    key: readonlySchema(IdentifierSchema),
    inputSchema: readonlySchema(ValueSchemaSchema),
    outputSchema: readonlySchema(ValueSchemaSchema),
    region: readonlySchema(SourceRegionSchema),
  }),
);
export type PipelineSourceModule = Static<typeof PipelineSourceModuleSchema>;

type ExactPipelineSourcePackage = {
  readonly schemaVersion: 'pipeline-source/v1';
  readonly key: string;
  readonly entryModule: string;
  readonly maximumTotalActivities: number;
  readonly modules: readonly [PipelineSourceModule, ...PipelineSourceModule[]];
};

export const PipelineSourcePackageSchema = Type.Unsafe<ExactPipelineSourcePackage>(
  closedObject({
    schemaVersion: readonlySchema(Type.Literal('pipeline-source/v1')),
    key: readonlySchema(IdentifierSchema),
    entryModule: readonlySchema(IdentifierSchema),
    maximumTotalActivities: readonlySchema(
      Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.sourcePackage.totalActivities }),
    ),
    modules: readonlySchema(
      nonEmptyArraySchema(PipelineSourceModuleSchema, PIPELINE_LIMITS.sourcePackage.modules),
    ),
  }),
);
export type PipelineSourcePackage = Static<typeof PipelineSourcePackageSchema>;
