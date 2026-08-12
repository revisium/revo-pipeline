import { appendJsonPointer, isIdentifier, type JsonPointer } from '../../foundation/index.js';
import type { SourceNode, SourceRegion } from '../contracts/index.js';
import { nestedPath } from '../internal.js';

type Target = {
  readonly key: string;
  readonly path: JsonPointer;
};

export type RegionGraphAnalysis = {
  readonly entryMissing: boolean;
  readonly invalidTargetPaths: readonly JsonPointer[];
  readonly reachable: ReadonlySet<string>;
  readonly targetCount: number;
  readonly unreachablePath?: JsonPointer;
  readonly cyclicPath?: JsonPointer;
  readonly nonExitingPath?: JsonPointer;
};

const activityTargets = (node: SourceNode, path: JsonPointer): readonly Target[] => {
  if (node.kind === 'agent') {
    return node.strategies.flatMap((strategy, index) =>
      Object.entries(strategy.routes).map(([route, key]) => ({
        key,
        path: nestedPath(path, 'strategies', String(index), 'routes', route),
      })),
    );
  }
  if (node.kind === 'script' || node.kind === 'effect') {
    return Object.entries(node.routes).map(([route, key]) => ({
      key,
      path: nestedPath(path, 'routes', route),
    }));
  }
  return [];
};

const fixedRouteTargets = (node: SourceNode, path: JsonPointer): readonly Target[] => {
  switch (node.kind) {
    case 'parallel':
    case 'repeat':
    case 'map':
    case 'wait':
    case 'consensus':
      return Object.entries(node.routes).map(([route, key]) => ({
        key,
        path: nestedPath(path, 'routes', route),
      }));
    case 'agent':
    case 'call':
    case 'choice':
    case 'effect':
    case 'end':
    case 'humanGate':
    case 'script':
      return [];
  }
  throw new TypeError('Unexpected schema-validated source node.');
};

const nodeTargets = (node: SourceNode, path: JsonPointer): readonly Target[] => {
  const simple = [...activityTargets(node, path), ...fixedRouteTargets(node, path)];
  if (simple.length > 0 || node.kind === 'end') {
    return simple;
  }
  if (node.kind === 'choice') {
    return [
      ...node.cases.map(({ target }, index) => ({
        key: target,
        path: nestedPath(path, 'cases', String(index), 'target'),
      })),
      ...(node.otherwise === null
        ? []
        : [{ key: node.otherwise, path: appendJsonPointer(path, 'otherwise') }]),
    ];
  }
  if (node.kind === 'humanGate') {
    return [
      ...node.routes.answers.map(({ target }, index) => ({
        key: target,
        path: nestedPath(path, 'routes', 'answers', String(index), 'target'),
      })),
      ...(['conflict', 'deadline', 'cancelled'] as const).map((route) => ({
        key: node.routes[route],
        path: nestedPath(path, 'routes', route),
      })),
    ];
  }
  if (node.kind === 'call') {
    return [
      ...node.routes.outcomes.map(({ target }, index) => ({
        key: target,
        path: nestedPath(path, 'routes', 'outcomes', String(index), 'target'),
      })),
      { key: node.routes.failed, path: nestedPath(path, 'routes', 'failed') },
      { key: node.routes.cancelled, path: nestedPath(path, 'routes', 'cancelled') },
    ];
  }
  return [];
};

const reachableNodes = (
  entry: string,
  edges: ReadonlyMap<string, readonly Target[]>,
): ReadonlySet<string> => {
  const reachable = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || reachable.has(current)) {
      continue;
    }
    reachable.add(current);
    for (const { key } of edges.get(current) ?? []) {
      pending.push(key);
    }
  }
  return reachable;
};

const nodesThatCanExit = (
  nodes: readonly SourceNode[],
  edges: ReadonlyMap<string, readonly Target[]>,
): ReadonlySet<string> => {
  const reverse = reverseEdges(new Set(nodes.map(({ key }) => key)), edges);
  const canExit = new Set(nodes.filter(({ kind }) => kind === 'end').map(({ key }) => key));
  const pending = [...canExit];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    for (const predecessor of reverse.get(current) ?? []) {
      if (!canExit.has(predecessor)) {
        canExit.add(predecessor);
        pending.push(predecessor);
      }
    }
  }
  return canExit;
};

type FinishTask = { readonly key: string; readonly expanded: boolean };

const scheduleFinishVisit = (
  key: string,
  reachable: ReadonlySet<string>,
  edges: ReadonlyMap<string, readonly Target[]>,
  visited: Set<string>,
  pending: FinishTask[],
): void => {
  if (visited.has(key)) {
    return;
  }
  visited.add(key);
  pending.push({ key, expanded: true });
  for (const target of edges.get(key) ?? []) {
    if (reachable.has(target.key) && !visited.has(target.key)) {
      pending.push({ key: target.key, expanded: false });
    }
  }
};

const appendFinishOrder = (
  start: string,
  reachable: ReadonlySet<string>,
  edges: ReadonlyMap<string, readonly Target[]>,
  visited: Set<string>,
  finished: string[],
): void => {
  const pending: FinishTask[] = [{ key: start, expanded: false }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    if (current.expanded) {
      finished.push(current.key);
    } else {
      scheduleFinishVisit(current.key, reachable, edges, visited, pending);
    }
  }
};

const finishOrder = (
  reachable: ReadonlySet<string>,
  edges: ReadonlyMap<string, readonly Target[]>,
): readonly string[] => {
  const visited = new Set<string>();
  const finished: string[] = [];
  for (const start of reachable) {
    appendFinishOrder(start, reachable, edges, visited, finished);
  }
  return finished;
};

function reverseEdges(
  reachable: ReadonlySet<string>,
  edges: ReadonlyMap<string, readonly Target[]>,
): ReadonlyMap<string, readonly string[]> {
  const reverse = new Map<string, string[]>([...reachable].map((key) => [key, []]));
  for (const key of reachable) {
    for (const target of edges.get(key) ?? []) {
      reverse.get(target.key)?.push(key);
    }
  }
  return reverse;
}

const collectComponent = (
  start: string,
  reverse: ReadonlyMap<string, readonly string[]>,
  assigned: Set<string>,
): readonly string[] => {
  const component: string[] = [];
  const pending = [start];
  assigned.add(start);
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    component.push(current);
    for (const predecessor of reverse.get(current) ?? []) {
      if (!assigned.has(predecessor)) {
        assigned.add(predecessor);
        pending.push(predecessor);
      }
    }
  }
  return component;
};

const isCyclicComponent = (
  component: readonly string[],
  edges: ReadonlyMap<string, readonly Target[]>,
): boolean => {
  if (component.length > 1) {
    return true;
  }
  const key = component[0];
  return key !== undefined && (edges.get(key) ?? []).some((target) => target.key === key);
};

const cyclicNodes = (
  reachable: ReadonlySet<string>,
  edges: ReadonlyMap<string, readonly Target[]>,
): ReadonlySet<string> => {
  const finished = finishOrder(reachable, edges);
  const reverse = reverseEdges(reachable, edges);
  const assigned = new Set<string>();
  const cyclic = new Set<string>();
  for (let index = finished.length - 1; index >= 0; index -= 1) {
    const start = finished[index];
    if (start === undefined || assigned.has(start)) {
      continue;
    }
    const component = collectComponent(start, reverse, assigned);
    if (isCyclicComponent(component, edges)) {
      for (const key of component) {
        cyclic.add(key);
      }
    }
  }
  return cyclic;
};

const nodePath = (regionPath: JsonPointer, index: number): JsonPointer =>
  nestedPath(regionPath, 'nodes', String(index));

export const analyzeRegionGraph = (
  region: SourceRegion,
  path: JsonPointer,
): RegionGraphAnalysis => {
  const nodes = new Map(region.nodes.map((node) => [node.key, node]));
  if (!nodes.has(region.entry)) {
    return {
      entryMissing: true,
      invalidTargetPaths: [],
      reachable: new Set(),
      targetCount: 0,
    };
  }

  const edges = new Map<string, readonly Target[]>();
  const invalidTargetPaths: JsonPointer[] = [];
  let targetCount = 0;
  for (const [index, node] of region.nodes.entries()) {
    const targets = nodeTargets(node, nodePath(path, index));
    targetCount += targets.length;
    for (const target of targets) {
      if (!isIdentifier(target.key) || !nodes.has(target.key)) {
        invalidTargetPaths.push(target.path);
      }
    }
    edges.set(
      node.key,
      targets.filter(({ key }) => nodes.has(key)),
    );
  }

  const reachable = reachableNodes(region.entry, edges);
  const unreachableIndex = region.nodes.findIndex(({ key }) => !reachable.has(key));
  const cyclic = cyclicNodes(reachable, edges);
  const cyclicIndex = region.nodes.findIndex(({ key }) => cyclic.has(key));
  const canExit = nodesThatCanExit(region.nodes, edges);
  const nonExitingIndex = region.nodes.findIndex(
    ({ key }) => reachable.has(key) && !canExit.has(key),
  );

  return {
    entryMissing: false,
    invalidTargetPaths: Object.freeze(invalidTargetPaths),
    reachable,
    targetCount,
    ...(unreachableIndex < 0 ? {} : { unreachablePath: nodePath(path, unreachableIndex) }),
    ...(cyclicIndex < 0 ? {} : { cyclicPath: nodePath(path, cyclicIndex) }),
    ...(nonExitingIndex < 0 ? {} : { nonExitingPath: nodePath(path, nonExitingIndex) }),
  };
};
