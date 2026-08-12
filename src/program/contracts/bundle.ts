import { type Static } from 'typebox';

import { closedObject, readonlySchema } from '../../foundation/index.js';
import { PipelineProgramSchema } from './program.js';
import { ProgramProvenanceSchema } from './provenance.js';
import { ProgramRequirementsSchema } from './requirements.js';

export const ProgramDigestInputSchema = closedObject({
  program: readonlySchema(PipelineProgramSchema),
  requirements: readonlySchema(ProgramRequirementsSchema),
  provenance: readonlySchema(ProgramProvenanceSchema),
});
export type ProgramDigestInput = Static<typeof ProgramDigestInputSchema>;
