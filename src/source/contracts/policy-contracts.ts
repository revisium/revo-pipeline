import { Type, type Static } from 'typebox';

import {
  ConsensusPolicySchema,
  PIPELINE_LIMITS,
  closedObject,
  readonlySchema,
} from '../../foundation/index.js';
import { IdentifierSchema } from './schema-builders.js';

export const ActivityRoutesSchema = closedObject({
  succeeded: readonlySchema(IdentifierSchema),
  failed: readonlySchema(IdentifierSchema),
  cancelled: readonlySchema(IdentifierSchema),
});
export type ActivityRoutes = Static<typeof ActivityRoutesSchema>;

export const ConsensusRoutesSchema = closedObject({
  approved: readonlySchema(IdentifierSchema),
  rejected: readonlySchema(IdentifierSchema),
  inconclusive: readonlySchema(IdentifierSchema),
  participantFailed: readonlySchema(IdentifierSchema),
  cancelled: readonlySchema(IdentifierSchema),
});
export type ConsensusRoutes = Static<typeof ConsensusRoutesSchema>;

export const AgentSlotStrategySchema = Type.Union([
  closedObject({
    kind: readonlySchema(Type.Literal('single')),
    routes: readonlySchema(ActivityRoutesSchema),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('consensus')),
    minimumParticipants: readonlySchema(
      Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.structured.participants }),
    ),
    maximumParticipants: readonlySchema(
      Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.structured.participants }),
    ),
    policy: readonlySchema(ConsensusPolicySchema),
    remaining: readonlySchema(Type.Union([Type.Literal('drain'), Type.Literal('cancel')])),
    routes: readonlySchema(ConsensusRoutesSchema),
  }),
]);
export type AgentSlotStrategy = Static<typeof AgentSlotStrategySchema>;
export type SingleAgentStrategy = Extract<AgentSlotStrategy, { readonly kind: 'single' }>;
export type ConsensusAgentStrategy = Extract<AgentSlotStrategy, { readonly kind: 'consensus' }>;

export type ParallelRoutes = {
  readonly completed: string;
  readonly impossible: string;
  readonly failed: string;
  readonly cancelled: string;
};

export {
  ConsensusPolicySchema,
  type ConsensusPolicy,
  type ParallelBranchClassification,
  type ParallelPolicy,
  type RegionExitClassification,
} from '../../foundation/index.js';
