import type { PipelineProgram } from '../contracts/index.js';
import { acknowledgementWork, reverseIndexWork } from './cancellation-envelope.js';
import { PROGRAM_ADMISSION_LIMITS, type ProgramAdmissionLimit } from './limits.js';
import { measureProgramModuleGraph } from './module-graph.js';
import { analyseRegionWork, type WorkEnvelope } from './quiescence.js';
import { measureProgramResources, type ProgramResourceEnvelope } from './resources.js';
import { measureProgramStructure, type ProgramStructureMeasure } from './structure.js';

export type ProgramAdmissionViolation = {
  readonly limit: ProgramAdmissionLimit;
  readonly actual: number;
  readonly maximum: number;
};

export type ProgramAnalysis = {
  readonly structure: ProgramStructureMeasure;
  readonly work: WorkEnvelope;
  readonly resources: ProgramResourceEnvelope;
};

export type ProgramAnalysisResult =
  | { readonly ok: true; readonly analysis: ProgramAnalysis }
  | {
      readonly ok: false;
      readonly analysis: ProgramAnalysis;
      readonly violation: ProgramAdmissionViolation;
    };

const measureWork = (
  program: PipelineProgram,
  dependencyOrder: readonly string[],
): WorkEnvelope => {
  const modules = new Map(program.modules.map((module) => [module.key, module]));
  const work = new Map<string, WorkEnvelope>();
  for (const key of dependencyOrder) {
    const module = modules.get(key);
    if (module !== undefined) {
      work.set(key, analyseRegionWork(module.region, work));
    }
  }
  const values = [...work.values()];
  if (values.length === 0) {
    return Object.freeze({ start: 0, resume: 0, cancel: 0, tokens: 0, synchronous: 0 });
  }
  return Object.freeze({
    start: Math.max(...values.map(({ start }) => start)),
    resume: Math.max(...values.map(({ resume }) => resume)),
    cancel: Math.max(...values.map(({ cancel }) => cancel)),
    tokens: Math.max(...values.map(({ tokens }) => tokens)),
    synchronous: Math.max(...values.map(({ synchronous }) => synchronous ?? 0)),
  });
};

const violation = (
  limit: ProgramAdmissionLimit,
  actual: number,
): ProgramAdmissionViolation | null => {
  const maximum = PROGRAM_ADMISSION_LIMITS[limit];
  return actual > maximum ? Object.freeze({ limit, actual, maximum }) : null;
};

const firstViolation = (analysis: ProgramAnalysis): ProgramAdmissionViolation | null => {
  const { structure, work, resources } = analysis;
  const synchronousWork = Math.max(
    work.start,
    work.resume,
    work.cancel,
    reverseIndexWork(resources.cancellation) + acknowledgementWork(resources.cancellation),
  );
  const checks: readonly (readonly [ProgramAdmissionLimit, number])[] = [
    ['modules', structure.modules],
    ['nodes', structure.nodes],
    ['regions', structure.regions],
    ['targets', structure.targets],
    ['nestingDepth', structure.nestingDepth],
    ['callDepth', structure.callDepth],
    ['synchronousWork', synchronousWork],
    ['liveFrames', resources.frames],
    ['liveOperations', resources.operations],
    ['nodeResults', resources.nodeResults],
    ['collectionSlots', resources.collectionSlots],
    ['cancellationMemberships', resources.cancellation.memberships],
    ['stateJsonValues', resources.stateJsonValues],
    ['commandJsonValues', resources.commandJsonValues],
  ];
  for (const [limit, actual] of checks) {
    const exceeded = violation(limit, actual);
    if (exceeded !== null) {
      return exceeded;
    }
  }
  return null;
};

export const analyzeProgram = (program: PipelineProgram): ProgramAnalysisResult => {
  const moduleGraph = measureProgramModuleGraph(program);
  const analysis: ProgramAnalysis = Object.freeze({
    structure: measureProgramStructure(program, moduleGraph),
    work: measureWork(program, moduleGraph.dependencyOrder),
    resources: measureProgramResources(program, moduleGraph.dependencyOrder),
  });
  const exceeded = firstViolation(analysis);
  return exceeded === null
    ? Object.freeze({ ok: true, analysis })
    : Object.freeze({ ok: false, analysis, violation: exceeded });
};
