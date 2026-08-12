import { Type, type Static } from 'typebox';

import { PIPELINE_LIMITS } from './bounds.js';
import { closedObject, readonlySchema } from './typebox.js';

export const ConsensusPolicySchema = Type.Union([
  closedObject({ kind: readonlySchema(Type.Literal('unanimous')) }),
  closedObject({
    kind: readonlySchema(Type.Literal('quorum')),
    minimumParticipation: readonlySchema(
      Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.structured.participants }),
    ),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('independentThreshold')),
    approveThreshold: readonlySchema(
      Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.structured.participants }),
    ),
    rejectThreshold: readonlySchema(
      Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.structured.participants }),
    ),
  }),
]);
export type ConsensusPolicy = Static<typeof ConsensusPolicySchema>;

export const ParallelPolicySchema = Type.Union([
  closedObject({ kind: readonlySchema(Type.Literal('all')) }),
  closedObject({ kind: readonlySchema(Type.Literal('any')) }),
  closedObject({
    kind: readonlySchema(Type.Literal('threshold')),
    count: readonlySchema(
      Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.structured.participants }),
    ),
  }),
]);
export type ParallelPolicy = Static<typeof ParallelPolicySchema>;

export const ParallelBranchClassificationSchema = Type.Union([
  Type.Literal('qualifies'),
  Type.Literal('doesNotQualify'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
]);
export type ParallelBranchClassification = Static<typeof ParallelBranchClassificationSchema>;

export type RegionExitClassification<Classification extends string> = {
  readonly outcome: string;
  readonly classification: Classification;
};
