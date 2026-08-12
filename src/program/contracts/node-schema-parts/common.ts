import { Type, type TSchema } from 'typebox';

import {
  DigestSchema,
  IdentifierSchema,
  ParallelBranchClassificationSchema,
  closedObject,
  readonlySchema,
} from '../../../foundation/index.js';

export const ProgramNodeIdSchema = DigestSchema;

export const targetRoutes = (keys: readonly string[]) =>
  closedObject(Object.fromEntries(keys.map((key) => [key, readonlySchema(ProgramNodeIdSchema)])));

export const regionExitClassificationSchema = (classification: TSchema) =>
  closedObject({
    outcome: readonlySchema(IdentifierSchema),
    classification: readonlySchema(classification),
  });

export const genericBranchClassificationSchema = ParallelBranchClassificationSchema;

export const stringLiterals = (values: readonly string[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));
