import type {
  PipelineProgram,
  ProgramNode,
  ProgramNodeId,
  ProgramRegion,
} from '../contracts/index.js';
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

export const programNodeTargets = (node: ProgramNode): readonly ProgramNodeId[] => {
  switch (node.kind) {
    case 'activity':
      return Object.values(node.routes);
    case 'choice':
      return [
        ...node.cases.map(({ target }) => target),
        ...(node.otherwise === null ? [] : [node.otherwise]),
      ];
    case 'call':
      return [
        ...node.routes.outcomes.map(({ target }) => target),
        node.routes.failed,
        node.routes.cancelled,
      ];
    case 'parallel':
      return [node.next];
    case 'repeat':
    case 'map':
    case 'wait':
      return Object.values(node.routes);
    case 'humanGate':
      return [
        ...node.routes.answers.map(({ target }) => target),
        node.routes.conflict,
        node.routes.deadline,
        node.routes.cancelled,
      ];
    case 'end':
      return [];
  }
  node satisfies never;
  throw new TypeError('Unexpected Program node kind.');
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
