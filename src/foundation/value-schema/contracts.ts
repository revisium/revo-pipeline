import { Type, type Static } from 'typebox';

import { PIPELINE_LIMITS } from '../bounds.js';
import type { JsonScalar } from '../portable-value.js';
import {
  SafeIntegerSchema,
  JsonScalarSchema,
  atLeastTwoSchema,
  closedObject,
  immutableArraySchema,
  optionalReadonlySchema,
  readonlySchema,
} from '../typebox.js';

type ExactValueSchema =
  | { readonly type: 'null' }
  | { readonly type: 'boolean' }
  | {
      readonly type: 'integer';
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | {
      readonly type: 'number';
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | {
      readonly type: 'string';
      readonly enum?: readonly string[];
      readonly minLength?: number;
      readonly maxLength?: number;
    }
  | {
      readonly type: 'array';
      readonly items: ExactValueSchema;
      readonly minItems?: number;
      readonly maxItems?: number;
    }
  | {
      readonly type: 'object';
      readonly properties: Readonly<Record<string, ExactValueSchema>>;
      readonly required: readonly string[];
      readonly additionalProperties: false;
    }
  | {
      readonly anyOf: readonly [ExactValueSchema, ExactValueSchema, ...ExactValueSchema[]];
    };

const valueSchemaDefinitions = {
  ValueSchema: Type.Union([
    closedObject({ type: readonlySchema(Type.Literal('null')) }),
    closedObject({ type: readonlySchema(Type.Literal('boolean')) }),
    closedObject({
      type: readonlySchema(Type.Literal('integer')),
      minimum: optionalReadonlySchema(SafeIntegerSchema),
      maximum: optionalReadonlySchema(SafeIntegerSchema),
    }),
    closedObject({
      type: readonlySchema(Type.Literal('number')),
      minimum: optionalReadonlySchema(SafeIntegerSchema),
      maximum: optionalReadonlySchema(SafeIntegerSchema),
    }),
    closedObject({
      type: readonlySchema(Type.Literal('string')),
      enum: optionalReadonlySchema(immutableArraySchema(Type.String())),
      minLength: optionalReadonlySchema(SafeIntegerSchema),
      maxLength: optionalReadonlySchema(SafeIntegerSchema),
    }),
    closedObject({
      type: readonlySchema(Type.Literal('array')),
      items: readonlySchema(Type.Ref('ValueSchema')),
      minItems: optionalReadonlySchema(SafeIntegerSchema),
      maxItems: optionalReadonlySchema(SafeIntegerSchema),
    }),
    closedObject({
      type: readonlySchema(Type.Literal('object')),
      properties: readonlySchema(
        Type.Record(Type.String(), Type.Ref('ValueSchema'), {
          maxProperties: PIPELINE_LIMITS.portableValue.objectKeys,
        }),
      ),
      required: readonlySchema(
        immutableArraySchema(Type.String(), PIPELINE_LIMITS.portableValue.objectKeys),
      ),
      additionalProperties: readonlySchema(Type.Literal(false)),
    }),
    closedObject({ anyOf: readonlySchema(atLeastTwoSchema(Type.Ref('ValueSchema'))) }),
  ]),
};

export const ValueSchemaSchema = Type.Unsafe<ExactValueSchema>(
  Type.Cyclic(valueSchemaDefinitions, 'ValueSchema'),
);
export type ValueSchema = Static<typeof ValueSchemaSchema>;

export const EmptyObjectSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  required: Object.freeze([]),
  additionalProperties: false,
}) satisfies ValueSchema;

export const PipelineFailureValueSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    code: Object.freeze({ type: 'string' }),
    path: Object.freeze({ type: 'string' }),
  }),
  required: Object.freeze(['code', 'path']),
  additionalProperties: false,
}) satisfies ValueSchema;

export const ChoiceDomainSchema = Type.Union([
  closedObject({
    kind: readonlySchema(Type.Literal('equals')),
    value: readonlySchema(JsonScalarSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('oneOf')),
    values: readonlySchema(
      Type.Unsafe<readonly [JsonScalar, ...JsonScalar[]]>(
        Type.Array(JsonScalarSchema, {
          minItems: 1,
          maxItems: PIPELINE_LIMITS.portableValue.arrayItems,
        }),
      ),
    ),
  }),
]);
export type ChoiceDomain = Static<typeof ChoiceDomainSchema>;
