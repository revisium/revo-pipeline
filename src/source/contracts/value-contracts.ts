import { Type, type Static } from 'typebox';

import {
  JsonPointerSchema,
  JsonScalarSchema,
  JsonValueSchema,
  PIPELINE_LIMITS,
  atLeastTwoSchema,
  closedObject,
  nonEmptyArraySchema,
  readonlySchema,
  type JsonScalar,
} from '../../foundation/index.js';

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

type ExactRepeatCondition =
  | { readonly kind: 'equals'; readonly selector: ValueSelector; readonly value: JsonScalar }
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

export {
  ChoiceDomainSchema,
  EmptyObjectSchema,
  PipelineFailureValueSchema,
  ValueSchemaSchema,
  type ChoiceDomain,
  type ValueSchema,
} from '../../foundation/index.js';
