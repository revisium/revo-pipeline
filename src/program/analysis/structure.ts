import { localTargets as programNodeTargets } from '../admission/graphs.js';
import type { PipelineProgram, ProgramNode, ProgramRegion } from '../contracts/index.js';
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

const childRegions = (node: ProgramNode): readonly ProgramRegion[] => {
  if (node.kind === 'parallel') {
    return node.branches.map(({ region }) => region);
  }
  return node.kind === 'repeat' || node.kind === 'map' ? [node.body] : [];
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
