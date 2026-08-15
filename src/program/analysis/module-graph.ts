import type { PipelineProgram, ProgramRegion } from '../contracts/index.js';
import { topologicalIndexes } from '../topological-order.js';

export type ProgramModuleGraph = {
  readonly dependencyOrder: readonly string[];
  readonly callDepth: number;
};

const collectRegionDependencies = (
  moduleKey: string,
  root: ProgramRegion,
  dependencies: Map<string, Set<string>>,
): void => {
  const pending = [root];
  while (pending.length > 0) {
    const region = pending.pop();
    if (region === undefined) {
      continue;
    }
    for (const node of region.nodes) {
      if (node.kind === 'call') {
        dependencies.get(moduleKey)?.add(node.module);
      } else if (node.kind === 'parallel') {
        pending.push(...node.branches.map(({ region: child }) => child));
      } else if (node.kind === 'repeat' || node.kind === 'map') {
        pending.push(node.body);
      }
    }
  }
};

const dependencyOrder = (dependencies: ReadonlyMap<string, ReadonlySet<string>>): string[] => {
  const keys = [...dependencies.keys()];
  const indexByKey = new Map(keys.map((key, index) => [key, index]));
  const dependents = keys.map(() => [] as number[]);
  for (const [key, values] of dependencies) {
    const dependent = indexByKey.get(key);
    if (dependent === undefined) {
      continue;
    }
    for (const dependency of values) {
      const dependencyIndex = indexByKey.get(dependency);
      if (dependencyIndex !== undefined) {
        dependents[dependencyIndex]?.push(dependent);
      }
    }
  }
  return topologicalIndexes(dependents, 'fifo')
    .indexes.map((index) => keys[index]!)
    .filter(Boolean);
};

const maximumCallDepth = (
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  order: readonly string[],
): number => {
  const depths = new Map<string, number>();
  let maximum = 0;
  for (const key of order) {
    const depth = Math.max(
      0,
      ...[...(dependencies.get(key) ?? [])].map((dependency) => (depths.get(dependency) ?? 0) + 1),
    );
    depths.set(key, depth);
    maximum = Math.max(maximum, depth);
  }
  return maximum;
};

export const measureProgramModuleGraph = (program: PipelineProgram): ProgramModuleGraph => {
  const dependencies = new Map(program.modules.map(({ key }) => [key, new Set<string>()]));
  for (const module of program.modules) {
    collectRegionDependencies(module.key, module.region, dependencies);
  }
  const order = dependencyOrder(dependencies);
  return Object.freeze({
    dependencyOrder: Object.freeze(order),
    callDepth: maximumCallDepth(dependencies, order),
  });
};
