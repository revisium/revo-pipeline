import { Type } from 'typebox';

import { JsonPointerSchema, closedObject, readonlySchema } from '../../foundation/index.js';

export const PipelineFailureSchema = closedObject({
  code: readonlySchema(Type.String()),
  path: readonlySchema(JsonPointerSchema),
});
