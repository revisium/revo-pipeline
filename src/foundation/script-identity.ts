import { Type, type Static } from 'typebox';

import { readonlySchema } from './typebox.js';

const ScriptIdSchema = Type.String({
  pattern: String.raw`^script:(?![\s\S]*[\r\n])[\s\S]+$`,
});

export const ScriptVersionSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });

export const ScriptPinSchema = Type.Object(
  {
    id: readonlySchema(ScriptIdSchema),
    version: readonlySchema(ScriptVersionSchema),
  },
  { additionalProperties: false },
);
export type ScriptPin = Static<typeof ScriptPinSchema>;
