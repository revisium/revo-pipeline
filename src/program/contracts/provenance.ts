import { Type, type Static } from 'typebox';

import {
  IdentifierSchema,
  JsonPointerSchema,
  PIPELINE_LIMITS,
  closedObject,
  immutableArraySchema,
  nonEmptyArraySchema,
  readonlySchema,
} from '../../foundation/index.js';
import { ProgramNodeIdSchema } from './node-schema-parts/common.js';

export const LOWERING_ROLES = Object.freeze([
  'direct',
  'genericParallelChoice',
  'agentSingleActivity',
  'consensusParallel',
  'consensusParticipantRegion',
  'consensusParticipantActivity',
  'consensusParticipantExit',
  'consensusChoice',
] as const);

export type LoweringRole = (typeof LOWERING_ROLES)[number];
const LoweringRoleSchema = Type.Unsafe<LoweringRole>(
  Type.Union(LOWERING_ROLES.map((role) => Type.Literal(role))),
);

export const NodeProvenanceSchema = closedObject({
  programNodeId: readonlySchema(ProgramNodeIdSchema),
  sourceNodeId: readonlySchema(Type.Union([IdentifierSchema, Type.Null()])),
  sourcePath: readonlySchema(JsonPointerSchema),
  materializationPath: readonlySchema(Type.Union([JsonPointerSchema, Type.Null()])),
  loweringRole: readonlySchema(LoweringRoleSchema),
  ordinal: readonlySchema(Type.Integer({ minimum: 0 })),
});
export type NodeProvenance = Static<typeof NodeProvenanceSchema>;

export const RequirementProvenanceSchema = closedObject({
  requirementKey: readonlySchema(IdentifierSchema),
  sourcePaths: readonlySchema(
    nonEmptyArraySchema(JsonPointerSchema, PIPELINE_LIMITS.sourcePackage.totalActivities),
  ),
  materializationPaths: readonlySchema(
    immutableArraySchema(JsonPointerSchema, PIPELINE_LIMITS.sourcePackage.totalActivities),
  ),
});
export type RequirementProvenance = Static<typeof RequirementProvenanceSchema>;

export const ProgramProvenanceSchema = closedObject({
  schemaVersion: readonlySchema(Type.Literal('pipeline-provenance/v1')),
  nodes: readonlySchema(
    immutableArraySchema(NodeProvenanceSchema, PIPELINE_LIMITS.sourcePackage.totalActivities),
  ),
  requirements: readonlySchema(
    immutableArraySchema(
      RequirementProvenanceSchema,
      PIPELINE_LIMITS.sourcePackage.totalActivities,
    ),
  ),
});
export type ProgramProvenance = Static<typeof ProgramProvenanceSchema>;
