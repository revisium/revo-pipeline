import { Type, type Static } from 'typebox';

import { PIPELINE_LIMITS, closedObject, type JsonScalar } from '../../foundation/index.js';
import {
  JsonPointerSchema,
  JsonValueSchema,
  SafeIntegerSchema,
  atLeastTwoSchema,
  immutableArraySchema,
  nonEmptyArraySchema,
  optionalReadonlySchema,
  readonlySchema,
} from './schema-builders.js';

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

export const ValueSelectorSchema = Type.Union([
  closedObject({
    kind: readonlySchema(Type.Literal('literal')),
    value: readonlySchema(JsonValueSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('moduleInput')),
    pointer: readonlySchema(JsonPointerSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('scopeInput')),
    pointer: readonlySchema(JsonPointerSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('nodeOutput')),
    node: readonlySchema(Type.String()),
    pointer: readonlySchema(JsonPointerSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('nodeFailure')),
    node: readonlySchema(Type.String()),
    pointer: readonlySchema(JsonPointerSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('regionOutput')),
    pointer: readonlySchema(JsonPointerSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('repeat')),
    value: readonlySchema(Type.Union([Type.Literal('iteration'), Type.Literal('previousOutput')])),
    pointer: readonlySchema(JsonPointerSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('map')),
    value: readonlySchema(Type.Union([Type.Literal('item'), Type.Literal('itemKey')])),
    pointer: readonlySchema(JsonPointerSchema),
  }),
]);
export type ValueSelector = Static<typeof ValueSelectorSchema>;

export const ValueMappingSchema = Type.Record(Type.String(), ValueSelectorSchema, {
  maxProperties: PIPELINE_LIMITS.portableValue.objectKeys,
});
export type ValueMapping = Static<typeof ValueMappingSchema>;

const JsonScalarSchema = Type.Union([
  Type.Null(),
  Type.Boolean(),
  SafeIntegerSchema,
  Type.String(),
]);

export const ChoiceDomainSchema = Type.Union([
  closedObject({
    kind: readonlySchema(Type.Literal('equals')),
    value: readonlySchema(JsonScalarSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('oneOf')),
    values: readonlySchema(nonEmptyArraySchema(JsonScalarSchema)),
  }),
]);
export type ChoiceDomain = Static<typeof ChoiceDomainSchema>;

type ExactRepeatCondition =
  | {
      readonly kind: 'equals';
      readonly selector: ValueSelector;
      readonly value: JsonScalar;
    }
  | {
      readonly kind: 'oneOf';
      readonly selector: ValueSelector;
      readonly values: readonly [JsonScalar, ...JsonScalar[]];
    }
  | { readonly kind: 'exists'; readonly selector: ValueSelector }
  | {
      readonly kind: 'all';
      readonly conditions: readonly [
        ExactRepeatCondition,
        ExactRepeatCondition,
        ...ExactRepeatCondition[],
      ];
    }
  | {
      readonly kind: 'any';
      readonly conditions: readonly [
        ExactRepeatCondition,
        ExactRepeatCondition,
        ...ExactRepeatCondition[],
      ];
    }
  | { readonly kind: 'not'; readonly condition: ExactRepeatCondition };

const repeatConditionDefinitions = {
  RepeatCondition: Type.Union([
    closedObject({
      kind: readonlySchema(Type.Literal('equals')),
      selector: readonlySchema(ValueSelectorSchema),
      value: readonlySchema(JsonScalarSchema),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('oneOf')),
      selector: readonlySchema(ValueSelectorSchema),
      values: readonlySchema(nonEmptyArraySchema(JsonScalarSchema)),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('exists')),
      selector: readonlySchema(ValueSelectorSchema),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('all')),
      conditions: readonlySchema(atLeastTwoSchema(Type.Ref('RepeatCondition'))),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('any')),
      conditions: readonlySchema(atLeastTwoSchema(Type.Ref('RepeatCondition'))),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('not')),
      condition: readonlySchema(Type.Ref('RepeatCondition')),
    }),
  ]),
};

export const RepeatConditionSchema = Type.Unsafe<ExactRepeatCondition>(
  Type.Cyclic(repeatConditionDefinitions, 'RepeatCondition'),
);
export type RepeatCondition = Static<typeof RepeatConditionSchema>;
