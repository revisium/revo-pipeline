import { PIPELINE_LIMITS } from '../../foundation/index.js';

export const PROGRAM_ADMISSION_LIMITS = Object.freeze({
  modules: PIPELINE_LIMITS.sourcePackage.modules,
  nodes: PIPELINE_LIMITS.program.nodes,
  regions: PIPELINE_LIMITS.program.regions,
  targets: PIPELINE_LIMITS.program.targets,
  nestingDepth: PIPELINE_LIMITS.sourcePackage.nestingDepth,
  callDepth: PIPELINE_LIMITS.sourcePackage.callDepth,
  synchronousWork: PIPELINE_LIMITS.machine.synchronousStepsPerTransition,
  liveFrames: PIPELINE_LIMITS.machine.liveFrames,
  liveOperations: PIPELINE_LIMITS.machine.liveOperations,
  nodeResults: PIPELINE_LIMITS.machine.totalNodeResults,
  collectionSlots: PIPELINE_LIMITS.machine.structuralCollectionSlots,
  cancellationMemberships: PIPELINE_LIMITS.machine.cancellationMemberships,
  stateJsonValues: PIPELINE_LIMITS.machine.serializedStateJsonValues,
  commandJsonValues: PIPELINE_LIMITS.machine.commandJsonValuesPerTransition,
});

export type ProgramAdmissionLimit = keyof typeof PROGRAM_ADMISSION_LIMITS;

export type ProgramAdmissionViolation = {
  readonly limit: ProgramAdmissionLimit;
  readonly actual: number;
  readonly maximum: number;
};
