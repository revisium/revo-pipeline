import { Type, type Static, type TSchema, type TUnsafe } from 'typebox';

import {
  PIPELINE_LIMITS,
  type Digest,
  type JsonPointer,
  type JsonValue,
} from '../../foundation/index.js';

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
export const DigestSchema = Type.Unsafe<Digest>(Type.String({ pattern: '^sha256:[0-9a-f]{64}$' }));
export const SafeIntegerSchema = Type.Integer();

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
