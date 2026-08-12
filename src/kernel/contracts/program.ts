import { type Static } from 'typebox';

import { DigestSchema, closedObject, readonlySchema } from '../../foundation/index.js';
import { PipelineProgramSchema } from '../../program/index.js';

export const KernelProgramSchema = closedObject({
  program: readonlySchema(PipelineProgramSchema),
  programDigest: readonlySchema(DigestSchema),
});
export type KernelProgram = Static<typeof KernelProgramSchema>;
