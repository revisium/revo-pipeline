import { Type, type Static } from 'typebox';

import {
  DigestSchema,
  JsonValueSchema,
  PIPELINE_LIMITS,
  closedObject,
  immutableArraySchema,
  readonlySchema,
} from '../../foundation/index.js';
import { frameBaseProperties } from './schema-parts.js';

const regionExecutionProperties = {
  regionId: readonlySchema(DigestSchema),
  status: readonlySchema(
    Type.Union([
      Type.Literal('active'),
      Type.Literal('draining'),
      Type.Literal('cancelling'),
      Type.Literal('completed'),
    ]),
  ),
  ready: readonlySchema(immutableArraySchema(DigestSchema, PIPELINE_LIMITS.sourcePackage.nodes)),
  selectedExit: readonlySchema(
    Type.Union([
      closedObject({
        outcome: readonlySchema(Type.String()),
        output: readonlySchema(JsonValueSchema),
      }),
      Type.Null(),
    ]),
  ),
};

export const RegionExecutionStateSchema = closedObject(regionExecutionProperties);
export type RegionExecutionState = Static<typeof RegionExecutionStateSchema>;

export const RootRegionMachineFrameSchema = closedObject({
  ...frameBaseProperties,
  kind: readonlySchema(Type.Literal('rootRegion')),
  parentFrameKey: readonlySchema(Type.Null()),
  ...regionExecutionProperties,
});
export type RootRegionMachineFrame = Static<typeof RootRegionMachineFrameSchema>;

export const CallRegionMachineFrameSchema = closedObject({
  ...frameBaseProperties,
  kind: readonlySchema(Type.Literal('callRegion')),
  parentFrameKey: readonlySchema(DigestSchema),
  ...regionExecutionProperties,
});
export type CallRegionMachineFrame = Static<typeof CallRegionMachineFrameSchema>;

export const ParallelBranchMachineFrameSchema = closedObject({
  ...frameBaseProperties,
  kind: readonlySchema(Type.Literal('parallelBranch')),
  parentFrameKey: readonlySchema(DigestSchema),
  branchKey: readonlySchema(Type.String()),
  ...regionExecutionProperties,
});
export type ParallelBranchMachineFrame = Static<typeof ParallelBranchMachineFrameSchema>;

export const RepeatBodyMachineFrameSchema = closedObject({
  ...frameBaseProperties,
  kind: readonlySchema(Type.Literal('repeatBody')),
  parentFrameKey: readonlySchema(DigestSchema),
  ordinal: readonlySchema(Type.Integer({ minimum: 0 })),
  ...regionExecutionProperties,
});
export type RepeatBodyMachineFrame = Static<typeof RepeatBodyMachineFrameSchema>;

export const MapItemMachineFrameSchema = closedObject({
  ...frameBaseProperties,
  kind: readonlySchema(Type.Literal('mapItem')),
  parentFrameKey: readonlySchema(DigestSchema),
  itemKey: readonlySchema(Type.String()),
  ...regionExecutionProperties,
});
export type MapItemMachineFrame = Static<typeof MapItemMachineFrameSchema>;

export const RegionMachineFrameSchema = Type.Union([
  RootRegionMachineFrameSchema,
  CallRegionMachineFrameSchema,
  ParallelBranchMachineFrameSchema,
  RepeatBodyMachineFrameSchema,
  MapItemMachineFrameSchema,
]);
export type RegionMachineFrame = Static<typeof RegionMachineFrameSchema>;
