import { Type, type Static } from 'typebox';

import {
  DigestSchema,
  JsonValueSchema,
  PIPELINE_LIMITS,
  closedObject,
  immutableArraySchema,
  readonlySchema,
} from '../../foundation/index.js';
import { PipelineFailureSchema } from './failure.js';
import { MachineFrameSchema } from './frames.js';
import {
  PendingOperationSchema,
  RegionCancellationSchema,
  ResolvedOperationSchema,
  RunCancellationSchema,
} from './operations.js';

export const PipelineStateSchema = closedObject({
  schemaVersion: readonlySchema(Type.Literal('pipeline-state/v1')),
  programDigest: readonlySchema(DigestSchema),
  status: readonlySchema(
    Type.Union([
      Type.Literal('running'),
      Type.Literal('cancelling'),
      Type.Literal('succeeded'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
    ]),
  ),
  input: readonlySchema(JsonValueSchema),
  frames: readonlySchema(
    immutableArraySchema(MachineFrameSchema, PIPELINE_LIMITS.sourcePackage.totalActivities),
  ),
  pending: readonlySchema(
    immutableArraySchema(PendingOperationSchema, PIPELINE_LIMITS.sourcePackage.totalActivities),
  ),
  resolved: readonlySchema(
    immutableArraySchema(ResolvedOperationSchema, PIPELINE_LIMITS.sourcePackage.totalActivities),
  ),
  runCancellation: readonlySchema(Type.Union([RunCancellationSchema, Type.Null()])),
  regionCancellations: readonlySchema(
    immutableArraySchema(RegionCancellationSchema, PIPELINE_LIMITS.sourcePackage.totalActivities),
  ),
  result: readonlySchema(
    Type.Union([
      closedObject({
        outcome: readonlySchema(Type.String()),
        output: readonlySchema(JsonValueSchema),
      }),
      Type.Null(),
    ]),
  ),
  fault: readonlySchema(Type.Union([PipelineFailureSchema, Type.Null()])),
});
export type PipelineState = Static<typeof PipelineStateSchema>;
