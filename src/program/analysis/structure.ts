import { childRegions, localTargets as programNodeTargets } from '../admission/graphs.js';
import type { PipelineProgram } from '../contracts/index.js';
import {
  PROGRAM_ADMISSION_LIMITS,
  type ProgramAdmissionLimit,
  type ProgramAdmissionViolation,
} from './limits.js';
import type { ProgramModuleGraph } from './module-graph.js';

export type ProgramStructureMeasure = {
  readonly modules: number;
  readonly nodes: number;
  readonly regions: number;
  readonly targets: number;
  readonly nestingDepth: number;
  readonly callDepth: number;
  readonly nodeTargetCounts: ReadonlyMap<string, number>;
  readonly nodeIds: ReadonlySet<string>;
  readonly regionIds: ReadonlySet<string>;
};

const violation = (
  limit: ProgramAdmissionLimit,
  actual: number,
): ProgramAdmissionViolation | null => {
  const maximum = PROGRAM_ADMISSION_LIMITS[limit];
  return actual > maximum ? Object.freeze({ limit, actual, maximum }) : null;
};

export const firstProgramStructureViolation = (
  structure: ProgramStructureMeasure,
): ProgramAdmissionViolation | null => {
  const checks: readonly (readonly [ProgramAdmissionLimit, number])[] = [
    ['modules', structure.modules],
    ['nodes', structure.nodes],
    ['regions', structure.regions],
    ['targets', structure.targets],
    ['nestingDepth', structure.nestingDepth],
    ['callDepth', structure.callDepth],
  ];
  for (const [limit, actual] of checks) {
    const exceeded = violation(limit, actual);
    if (exceeded !== null) {
      return exceeded;
    }
  }
  return null;
};

export const measureProgramStructure = (
  program: PipelineProgram,
  moduleGraph: ProgramModuleGraph,
): ProgramStructureMeasure => {
  const nodeTargetCounts = new Map<string, number>();
  const nodeIds = new Set<string>();
  const regionIds = new Set<string>();
  let targets = 0;
  let nodes = 0;
  let nestingDepth = 0;
  const pending = program.modules.map(({ region }) => ({ region, depth: 0 }));
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === undefined) {
      break;
    }
    regionIds.add(task.region.id);
    nestingDepth = Math.max(nestingDepth, task.depth);
    for (const node of task.region.nodes) {
      nodes += 1;
      nodeIds.add(node.id);
      const count = programNodeTargets(node).length;
      targets += count;
      nodeTargetCounts.set(node.id, count);
      for (const child of childRegions(node)) {
        pending.push({ region: child, depth: task.depth + 1 });
      }
    }
  }
  return Object.freeze({
    modules: program.modules.length,
    nodes,
    regions: regionIds.size,
    targets,
    nestingDepth,
    callDepth: moduleGraph.callDepth,
    nodeTargetCounts,
    nodeIds,
    regionIds,
  });
};
