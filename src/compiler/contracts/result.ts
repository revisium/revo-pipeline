import { Type } from 'typebox';

import {
  DigestSchema,
  PIPELINE_LIMITS,
  PipelineDiagnosticSchema,
  closedObject,
  nonEmptyArraySchema,
  readonlySchema,
  type Digest,
  type PipelineDiagnostic,
} from '../../foundation/index.js';
import {
  PipelineProgramSchema,
  ProgramProvenanceSchema,
  ProgramRequirementsSchema,
  type PipelineProgram,
  type ProgramProvenance,
  type ProgramRequirements,
} from '../../program/index.js';

export type PipelineCompileResult =
  | {
      readonly ok: true;
      readonly sourceDigest: Digest;
      readonly materializationDigest: Digest;
      readonly programDigest: Digest;
      readonly program: PipelineProgram;
      readonly requirements: ProgramRequirements;
      readonly provenance: ProgramProvenance;
    }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

export const PipelineCompileResultSchema = Type.Union([
  closedObject({
    ok: readonlySchema(Type.Literal(true)),
    sourceDigest: readonlySchema(DigestSchema),
    materializationDigest: readonlySchema(DigestSchema),
    programDigest: readonlySchema(DigestSchema),
    program: readonlySchema(PipelineProgramSchema),
    requirements: readonlySchema(ProgramRequirementsSchema),
    provenance: readonlySchema(ProgramProvenanceSchema),
  }),
  closedObject({
    ok: readonlySchema(Type.Literal(false)),
    diagnostics: readonlySchema(
      nonEmptyArraySchema(PipelineDiagnosticSchema, PIPELINE_LIMITS.diagnostics),
    ),
  }),
]);
