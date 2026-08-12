import { Type, type Static } from 'typebox';

import {
  IdentifierSchema,
  PIPELINE_LIMITS,
  ValueSchemaSchema,
  closedObject,
  immutableArraySchema,
  readonlySchema,
} from '../../foundation/index.js';

export const AgentProgramRequirementSchema = closedObject({
  kind: readonlySchema(Type.Literal('agent')),
  key: readonlySchema(IdentifierSchema),
  bindingKey: readonlySchema(IdentifierSchema),
  inputSchema: readonlySchema(ValueSchemaSchema),
  outputSchema: readonlySchema(ValueSchemaSchema),
});
export type AgentProgramRequirement = Static<typeof AgentProgramRequirementSchema>;

export const ScriptProgramRequirementSchema = closedObject({
  kind: readonlySchema(Type.Literal('script')),
  key: readonlySchema(IdentifierSchema),
  script: readonlySchema(
    closedObject({
      key: readonlySchema(IdentifierSchema),
      revision: readonlySchema(Type.Integer({ minimum: 0 })),
    }),
  ),
  inputSchema: readonlySchema(ValueSchemaSchema),
  outputSchema: readonlySchema(ValueSchemaSchema),
});
export type ScriptProgramRequirement = Static<typeof ScriptProgramRequirementSchema>;

export const EffectProgramRequirementSchema = closedObject({
  kind: readonlySchema(Type.Literal('effect')),
  key: readonlySchema(IdentifierSchema),
  effectKey: readonlySchema(IdentifierSchema),
  inputSchema: readonlySchema(ValueSchemaSchema),
  outputSchema: readonlySchema(ValueSchemaSchema),
});
export type EffectProgramRequirement = Static<typeof EffectProgramRequirementSchema>;

export const ProgramRequirementSchema = Type.Union([
  AgentProgramRequirementSchema,
  ScriptProgramRequirementSchema,
  EffectProgramRequirementSchema,
]);
export type ProgramRequirement = Static<typeof ProgramRequirementSchema>;

export const ProgramRequirementsSchema = closedObject({
  schemaVersion: readonlySchema(Type.Literal('pipeline-requirements/v1')),
  entries: readonlySchema(
    immutableArraySchema(ProgramRequirementSchema, PIPELINE_LIMITS.sourcePackage.totalActivities),
  ),
});
export type ProgramRequirements = Static<typeof ProgramRequirementsSchema>;
