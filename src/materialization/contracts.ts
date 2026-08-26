import { Type, type Static } from 'typebox';

import {
  DigestSchema,
  IdentifierSchema,
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

const singleSelectionSchema = closedObject({
  strategy: readonlySchema(Type.Literal('single')),
  participant: readonlySchema(AbstractParticipantSchema),
});

const consensusSelectionSchema = closedObject({
  strategy: readonlySchema(Type.Literal('consensus')),
  participants: readonlySchema(
    nonEmptyArraySchema(AbstractParticipantSchema, PIPELINE_LIMITS.structured.participants),
  ),
});

// The public schema describes a usable selection. The envelope schema below is
// deliberately wider: validation turns malformed participant counts into the
// domain-specific MATERIALIZATION_POLICY_COUNT diagnostic.
const consensusSelectionEnvelopeSchema = closedObject({
  strategy: readonlySchema(Type.Literal('consensus')),
  participants: readonlySchema(
    Type.Array(AbstractParticipantSchema, {
      maxItems: PIPELINE_LIMITS.sourcePackage.nodes,
    }),
  ),
});

export const PipelineSelectionSchema = Type.Union([
  singleSelectionSchema,
  consensusSelectionSchema,
]);
export type PipelineSelection = Static<typeof PipelineSelectionSchema>;

type PipelineSelectionEnvelope =
  | Static<typeof singleSelectionSchema>
  | Static<typeof consensusSelectionEnvelopeSchema>;

export type PipelineSelections = Readonly<
  Record<import('../source/index.js').SourceNodeId, PipelineSelection>
>;

export const PipelineSelectionsSchema = Type.Unsafe<PipelineSelections>(
  Type.Record(IdentifierSchema, PipelineSelectionSchema, {
    maxProperties: PIPELINE_LIMITS.sourcePackage.nodes,
  }),
);

export const PipelineSelectionsEnvelopeSchema = Type.Unsafe<PipelineSelections>(
  Type.Record(
    Type.String(),
    Type.Unsafe<PipelineSelectionEnvelope>(
      Type.Union([singleSelectionSchema, consensusSelectionEnvelopeSchema]),
    ),
    {
      maxProperties: PIPELINE_LIMITS.sourcePackage.nodes,
    },
  ),
);

export type InternalSlotSelection =
  | { readonly strategy: 'single'; readonly participant: AbstractParticipant }
  | {
      readonly strategy: 'consensus';
      readonly participants: readonly [AbstractParticipant, ...AbstractParticipant[]];
    };

export type InternalAgentSlot = {
  readonly sourceNodeId: import('../source/index.js').SourceNodeId;
  readonly sourcePath: import('../foundation/index.js').JsonPointer;
  readonly selection: InternalSlotSelection;
};

export type InternalMaterialization = {
  readonly schemaVersion: 'pipeline-materialization/v1';
  readonly sourceDigest: Static<typeof DigestSchema>;
  readonly slots: readonly InternalAgentSlot[];
};
