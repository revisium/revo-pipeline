import { PIPELINE_LIMITS } from '../../foundation/index.js';
import type { MachineFrame } from '../contracts/frames.js';
import type { PipelineState } from '../contracts/state.js';

const frameCollectionSlots = (frame: MachineFrame): number => {
  const nodeResults = Object.keys(frame.nodeResults).length;
  if (
    frame.kind === 'rootRegion' ||
    frame.kind === 'callRegion' ||
    frame.kind === 'parallelBranch' ||
    frame.kind === 'repeatBody' ||
    frame.kind === 'mapItem'
  ) {
    return frame.ready.length + nodeResults;
  }
  if (frame.kind === 'parallel') {
    return (
      Object.keys(frame.branchRegionKeys).length +
      Object.keys(frame.branchResults).length +
      nodeResults
    );
  }
  if (frame.kind === 'map') {
    // The outer frames-array slot supplies the fourth constant map-owner slot.
    return 5 * frame.itemKeys.length + 3 + nodeResults;
  }
  return nodeResults;
};

const cancellationMemberships = (state: PipelineState): number =>
  (state.runCancellation?.awaiting.length ?? 0) +
  state.regionCancellations.reduce(
    (total, cancellation) => total + cancellation.awaiting.length,
    0,
  );

const structuralCollectionSlots = (state: PipelineState): number =>
  state.frames.length +
  state.pending.length +
  state.resolved.length +
  state.regionCancellations.length +
  cancellationMemberships(state) +
  state.frames.reduce((total, frame) => total + frameCollectionSlots(frame), 0);

const totalNodeResults = (state: PipelineState): number =>
  state.frames.reduce((total, frame) => total + Object.keys(frame.nodeResults).length, 0);

export const stateFitsMachineLimits = (state: PipelineState): boolean =>
  state.frames.length <= PIPELINE_LIMITS.machine.liveFrames &&
  state.pending.length <= PIPELINE_LIMITS.machine.liveOperations &&
  state.resolved.length <= PIPELINE_LIMITS.machine.liveOperations &&
  state.pending.length + state.resolved.length <= PIPELINE_LIMITS.machine.liveOperations &&
  state.regionCancellations.length <= PIPELINE_LIMITS.machine.liveFrames &&
  totalNodeResults(state) <= PIPELINE_LIMITS.machine.totalNodeResults &&
  cancellationMemberships(state) <= PIPELINE_LIMITS.machine.cancellationMemberships &&
  structuralCollectionSlots(state) <= PIPELINE_LIMITS.machine.structuralCollectionSlots;
