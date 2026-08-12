import { Type, type Static } from 'typebox';

import {
  DigestSchema,
  JsonPointerSchema,
  PIPELINE_LIMITS,
  closedObject,
  nonEmptyArraySchema,
  readonlySchema,
} from '../foundation/index.js';

export const AbstractParticipantSchema = closedObject({
  key: readonlySchema(Type.String()),
  bindingKey: readonlySchema(Type.String()),
});
export type AbstractParticipant = Static<typeof AbstractParticipantSchema>;

export const SlotSelectionSchema = Type.Union([
  closedObject({
    strategy: readonlySchema(Type.Literal('single')),
    participant: readonlySchema(AbstractParticipantSchema),
  }),
  closedObject({
    strategy: readonlySchema(Type.Literal('consensus')),
    participants: readonlySchema(
      nonEmptyArraySchema(AbstractParticipantSchema, PIPELINE_LIMITS.structured.participants),
    ),
  }),
]);
export type SlotSelection = Static<typeof SlotSelectionSchema>;

export const AgentSlotMaterializationSchema = closedObject({
  sourcePath: readonlySchema(JsonPointerSchema),
  slotKey: readonlySchema(Type.String()),
  selection: readonlySchema(SlotSelectionSchema),
});
export type AgentSlotMaterialization = Static<typeof AgentSlotMaterializationSchema>;

const profileMaterializationSchema = closedObject({
  schemaVersion: readonlySchema(Type.Literal('pipeline-materialization/v1')),
  sourceDigest: readonlySchema(DigestSchema),
  slots: readonlySchema(
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
