import { Type, type Static, type TSchema, type TUnsafe } from 'typebox';

import { PIPELINE_LIMITS, closedObject, type JsonPointer } from '../foundation/index.js';
import { DigestSchema, JsonPointerSchema } from '../source/index.js';

const readonly = <Schema extends TSchema>(schema: Schema) => Type.Readonly(schema);
const nonEmptyArray = <Schema extends TSchema>(
  schema: Schema,
  maximum: number,
): TUnsafe<readonly [Static<Schema>, ...Static<Schema>[]]> =>
  Type.Unsafe<readonly [Static<Schema>, ...Static<Schema>[]]>(
    Type.Array(schema, { minItems: 1, maxItems: maximum }),
  );

export const AbstractParticipantSchema = closedObject({
  key: readonly(Type.String()),
  bindingKey: readonly(Type.String()),
});
export type AbstractParticipant = Static<typeof AbstractParticipantSchema>;

export const SlotSelectionSchema = Type.Union([
  closedObject({
    strategy: readonly(Type.Literal('single')),
    participant: readonly(AbstractParticipantSchema),
  }),
  closedObject({
    strategy: readonly(Type.Literal('consensus')),
    participants: readonly(
      nonEmptyArray(AbstractParticipantSchema, PIPELINE_LIMITS.structured.participants),
    ),
  }),
]);
export type SlotSelection = Static<typeof SlotSelectionSchema>;

export const AgentSlotMaterializationSchema = closedObject({
  sourcePath: readonly(Type.Unsafe<JsonPointer>(JsonPointerSchema)),
  slotKey: readonly(Type.String()),
  selection: readonly(SlotSelectionSchema),
});
export type AgentSlotMaterialization = Static<typeof AgentSlotMaterializationSchema>;

const profileMaterializationSchema = closedObject({
  schemaVersion: readonly(Type.Literal('pipeline-materialization/v1')),
  sourceDigest: readonly(DigestSchema),
  slots: readonly(
    Type.Immutable(
      Type.Array(AgentSlotMaterializationSchema, {
        maxItems: PIPELINE_LIMITS.sourcePackage.nodes,
      }),
    ),
  ),
});
export const ProfileMaterializationSchema = Type.Unsafe<
  Static<typeof profileMaterializationSchema>
>(profileMaterializationSchema);
export type ProfileMaterialization = Static<typeof ProfileMaterializationSchema>;
