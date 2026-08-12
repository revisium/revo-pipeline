import { Type, type Static } from 'typebox';

import { RegionMachineFrameSchema } from './region-frames.js';
import {
  CallMachineFrameSchema,
  MapMachineFrameSchema,
  ParallelMachineFrameSchema,
  RepeatMachineFrameSchema,
} from './structured-frames.js';

export const MachineFrameSchema = Type.Union([
  RegionMachineFrameSchema,
  CallMachineFrameSchema,
  ParallelMachineFrameSchema,
  RepeatMachineFrameSchema,
  MapMachineFrameSchema,
]);
export type MachineFrame = Static<typeof MachineFrameSchema>;
