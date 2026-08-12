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
  type JsonPointer,
  type JsonValue,
} from '../../foundation/index.js';
import type { ProgramNodeId } from './identity.js';
import { ProgramNodeIdSchema } from './node-schema-parts/common.js';

type ExactProgramValueSelector =
  | { readonly kind: 'literal'; readonly value: JsonValue }
  | { readonly kind: 'moduleInput'; readonly pointer: JsonPointer }
  | { readonly kind: 'scopeInput'; readonly pointer: JsonPointer }
  | {
      readonly kind: 'nodeOutput';
      readonly nodeId: ProgramNodeId;
      readonly pointer: JsonPointer;
    }
  | {
      readonly kind: 'nodeFailure';
      readonly nodeId: ProgramNodeId;
      readonly pointer: JsonPointer;
    }
  | { readonly kind: 'regionOutput'; readonly pointer: JsonPointer }
  | {
      readonly kind: 'repeat';
      readonly value: 'iteration' | 'previousOutput';
      readonly pointer: JsonPointer;
    }
  | {
      readonly kind: 'map';
      readonly value: 'item' | 'itemKey';
      readonly pointer: JsonPointer;
    };

const nodeSelector = (kind: 'nodeOutput' | 'nodeFailure') =>
  closedObject({
    kind: readonlySchema(Type.Literal(kind)),
    nodeId: readonlySchema(ProgramNodeIdSchema),
    pointer: readonlySchema(JsonPointerSchema),
  });

export const ProgramValueSelectorSchema = Type.Unsafe<ExactProgramValueSelector>(
  Type.Union([
    closedObject({
      kind: readonlySchema(Type.Literal('literal')),
      value: readonlySchema(JsonValueSchema),
    }),
    ...(['moduleInput', 'scopeInput', 'regionOutput'] as const).map((kind) =>
      closedObject({
        kind: readonlySchema(Type.Literal(kind)),
        pointer: readonlySchema(JsonPointerSchema),
      }),
    ),
    nodeSelector('nodeOutput'),
    nodeSelector('nodeFailure'),
    closedObject({
      kind: readonlySchema(Type.Literal('repeat')),
      value: readonlySchema(
        Type.Union([Type.Literal('iteration'), Type.Literal('previousOutput')]),
      ),
      pointer: readonlySchema(JsonPointerSchema),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('map')),
      value: readonlySchema(Type.Union([Type.Literal('item'), Type.Literal('itemKey')])),
      pointer: readonlySchema(JsonPointerSchema),
    }),
  ]),
);
export type ProgramValueSelector = Static<typeof ProgramValueSelectorSchema>;

export const ProgramValueMappingSchema = Type.Record(Type.String(), ProgramValueSelectorSchema, {
  maxProperties: PIPELINE_LIMITS.portableValue.objectKeys,
});
export type ProgramValueMapping = Static<typeof ProgramValueMappingSchema>;

type ExactProgramRepeatCondition =
  | {
      readonly kind: 'equals';
      readonly selector: ProgramValueSelector;
      readonly value: JsonScalar;
    }
  | {
      readonly kind: 'oneOf';
      readonly selector: ProgramValueSelector;
      readonly values: readonly [JsonScalar, ...JsonScalar[]];
    }
  | { readonly kind: 'exists'; readonly selector: ProgramValueSelector }
  | {
      readonly kind: 'all';
      readonly conditions: readonly [
        ExactProgramRepeatCondition,
        ExactProgramRepeatCondition,
        ...ExactProgramRepeatCondition[],
      ];
    }
  | {
      readonly kind: 'any';
      readonly conditions: readonly [
        ExactProgramRepeatCondition,
        ExactProgramRepeatCondition,
        ...ExactProgramRepeatCondition[],
      ];
    }
  | { readonly kind: 'not'; readonly condition: ExactProgramRepeatCondition };

const repeatConditionDefinitions = {
  ProgramRepeatCondition: Type.Union([
    closedObject({
      kind: readonlySchema(Type.Literal('equals')),
      selector: readonlySchema(ProgramValueSelectorSchema),
      value: readonlySchema(JsonScalarSchema),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('oneOf')),
      selector: readonlySchema(ProgramValueSelectorSchema),
      values: readonlySchema(nonEmptyArraySchema(JsonScalarSchema)),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('exists')),
      selector: readonlySchema(ProgramValueSelectorSchema),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('all')),
      conditions: readonlySchema(atLeastTwoSchema(Type.Ref('ProgramRepeatCondition'))),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('any')),
      conditions: readonlySchema(atLeastTwoSchema(Type.Ref('ProgramRepeatCondition'))),
    }),
    closedObject({
      kind: readonlySchema(Type.Literal('not')),
      condition: readonlySchema(Type.Ref('ProgramRepeatCondition')),
    }),
  ]),
};

export const ProgramRepeatConditionSchema = Type.Unsafe<ExactProgramRepeatCondition>(
  Type.Cyclic(repeatConditionDefinitions, 'ProgramRepeatCondition'),
);
export type ProgramRepeatCondition = Static<typeof ProgramRepeatConditionSchema>;
