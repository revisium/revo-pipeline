import { Type, type Static, type TSchema, type TUnsafe } from 'typebox';

import { PIPELINE_LIMITS } from './bounds.js';
import { DIGEST_LEXICAL_PATTERN, type Digest } from './digest.js';
import type { JsonPointer } from './json-pointer.js';
import type { JsonScalar, JsonValue } from './portable-value.js';
import { closedObject } from './schema.js';

export const readonlySchema = <Schema extends TSchema>(schema: Schema) => Type.Readonly(schema);

export const optionalReadonlySchema = <Schema extends TSchema>(schema: Schema) =>
  Type.Optional(readonlySchema(schema));

export const immutableArraySchema = <Schema extends TSchema>(
  schema: Schema,
  maximum: number = PIPELINE_LIMITS.portableValue.arrayItems,
) => Type.Immutable(Type.Array(schema, { maxItems: maximum }));

export const nonEmptyArraySchema = <Schema extends TSchema>(
  schema: Schema,
  maximum: number = PIPELINE_LIMITS.portableValue.arrayItems,
): TUnsafe<readonly [Static<Schema>, ...Static<Schema>[]]> =>
  Type.Unsafe<readonly [Static<Schema>, ...Static<Schema>[]]>(
    Type.Array(schema, { minItems: 1, maxItems: maximum }),
  );

export const atLeastTwoSchema = <Schema extends TSchema>(
  schema: Schema,
  maximum: number = PIPELINE_LIMITS.portableValue.arrayItems,
): TUnsafe<readonly [Static<Schema>, Static<Schema>, ...Static<Schema>[]]> =>
  Type.Unsafe<readonly [Static<Schema>, Static<Schema>, ...Static<Schema>[]]>(
    Type.Array(schema, { minItems: 2, maxItems: maximum }),
  );

export const IdentifierSchema = Type.String();
export const DisplayStringSchema = Type.String();
export const JsonPointerSchema = Type.Unsafe<JsonPointer>(Type.String());
export const DigestSchema = Type.Unsafe<Digest>(Type.String({ pattern: DIGEST_LEXICAL_PATTERN }));
export const SafeIntegerSchema = Type.Integer();
export const JsonScalarSchema = Type.Unsafe<JsonScalar>(
  Type.Union([Type.Null(), Type.Boolean(), SafeIntegerSchema, Type.String()]),
);

const jsonValueDefinitions = {
  JsonValue: Type.Union([
    Type.Null(),
    Type.Boolean(),
    SafeIntegerSchema,
    Type.String(),
    Type.Array(Type.Ref('JsonValue'), {
      maxItems: PIPELINE_LIMITS.portableValue.arrayItems,
    }),
    Type.Object(
      {},
      {
        additionalProperties: Type.Ref('JsonValue'),
        maxProperties: PIPELINE_LIMITS.portableValue.objectKeys,
      },
    ),
  ]),
};

export const JsonValueSchema = Type.Unsafe<JsonValue>(
  Type.Cyclic(jsonValueDefinitions, 'JsonValue'),
);

export { closedObject };
