import { Type, type Static } from 'typebox';

import {
  DigestSchema,
  PIPELINE_LIMITS,
  closedObject,
  immutableArraySchema,
  readonlySchema,
} from '../../foundation/index.js';
import { CommandRefSchema } from './identity.js';

export const PendingOperationSchema = Type.Union([
  closedObject({
    kind: readonlySchema(Type.Literal('activity')),
    commandKey: readonlySchema(DigestSchema),
    ref: readonlySchema(CommandRefSchema),
    requirementKey: readonlySchema(Type.String()),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('wait')),
    commandKey: readonlySchema(DigestSchema),
    ref: readonlySchema(CommandRefSchema),
    waitKind: readonlySchema(Type.Union([Type.Literal('duration'), Type.Literal('signal')])),
  }),
  closedObject({
    kind: readonlySchema(Type.Literal('humanGate')),
    commandKey: readonlySchema(DigestSchema),
    ref: readonlySchema(CommandRefSchema),
  }),
]);
export type PendingOperation = Static<typeof PendingOperationSchema>;

export const ResolvedOperationSchema = closedObject({
  commandKey: readonlySchema(DigestSchema),
  ref: readonlySchema(CommandRefSchema),
  eventDigest: readonlySchema(DigestSchema),
});
export type ResolvedOperation = Static<typeof ResolvedOperationSchema>;

const awaitingSchema = readonlySchema(
  immutableArraySchema(DigestSchema, PIPELINE_LIMITS.sourcePackage.totalActivities),
);

export const RunCancellationSchema = closedObject({
  reasonCode: readonlySchema(Type.String()),
  awaiting: awaitingSchema,
});
export type RunCancellation = Static<typeof RunCancellationSchema>;

export const RegionCancellationSchema = closedObject({
  frameKey: readonlySchema(DigestSchema),
  reasonCode: readonlySchema(Type.String()),
  awaiting: awaitingSchema,
});
export type RegionCancellation = Static<typeof RegionCancellationSchema>;
