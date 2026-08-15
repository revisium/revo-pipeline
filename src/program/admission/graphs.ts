import type {
  ProgramModule,
  ProgramNode,
  ProgramNodeId,
  ProgramRegion,
} from '../contracts/index.js';
import { topologicalIndexes } from '../topological-order.js';

export type ModuleCallEdge = { readonly from: string; readonly to: string };

export const hasValidCallGraph = (
  modules: ReadonlyMap<string, ProgramModule>,
  edges: readonly ModuleCallEdge[],
): boolean => {
  const keys = [...modules.keys()];
  const indexByKey = new Map(keys.map((key, index) => [key, index]));
  const outgoing = keys.map(() => [] as number[]);
  for (const { from, to } of edges) {
    const fromIndex = indexByKey.get(from);
    const toIndex = indexByKey.get(to);
    if (fromIndex === undefined || toIndex === undefined) {
      return false;
    }
    outgoing[fromIndex]?.push(toIndex);
  }
  return topologicalIndexes(outgoing).complete;
};

export const localTargets = (node: ProgramNode): readonly ProgramNodeId[] => {
  switch (node.kind) {
    case 'activity':
      return [node.routes.succeeded, node.routes.failed, node.routes.cancelled];
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
  return [];
};

export const childRegions = (node: ProgramNode): readonly ProgramRegion[] => {
  switch (node.kind) {
    case 'parallel':
      return node.branches.map(({ region }) => region);
    case 'repeat':
    case 'map':
      return [node.body];
    case 'activity':
    case 'choice':
    case 'call':
    case 'wait':
    case 'humanGate':
    case 'end':
      return [];
  }
  node satisfies never;
  return [];
};

const visitFrom = (
  starts: readonly ProgramNodeId[],
  edges: ReadonlyMap<ProgramNodeId, readonly ProgramNodeId[]>,
) => {
  const visited = new Set<ProgramNodeId>();
  const pending = [...starts];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);
    pending.push(...(edges.get(current) ?? []));
  }
  return visited;
};

const reverseGraph = (edges: ReadonlyMap<ProgramNodeId, readonly ProgramNodeId[]>) => {
  const reverse = new Map<ProgramNodeId, ProgramNodeId[]>(
    [...edges.keys()].map((key) => [key, []]),
  );
  for (const [from, targets] of edges) {
    for (const target of targets) {
      reverse.get(target)?.push(from);
    }
  }
  return reverse;
};

const isAcyclic = (edges: ReadonlyMap<ProgramNodeId, readonly ProgramNodeId[]>): boolean => {
  const keys = [...edges.keys()];
  const indexByKey = new Map(keys.map((key, index) => [key, index]));
  const outgoing = keys.map((key) =>
    (edges.get(key) ?? []).flatMap((target) => {
      const index = indexByKey.get(target);
      return index === undefined ? [] : [index];
    }),
  );
  return topologicalIndexes(outgoing).complete;
};

export const hasValidRegionGraph = (region: ProgramRegion): boolean => {
  const nodeIds = new Set(region.nodes.map(({ id }) => id));
  const edges = new Map(region.nodes.map((node) => [node.id, localTargets(node)]));
  if (
    !nodeIds.has(region.entry) ||
    [...edges.values()].some((targets) => targets.some((target) => !nodeIds.has(target)))
  ) {
    return false;
  }
  const reachable = visitFrom([region.entry], edges);
  const ends = region.nodes.filter(({ kind }) => kind === 'end').map(({ id }) => id);
  const canExit = visitFrom(ends, reverseGraph(edges));
  return (
    reachable.size === region.nodes.length &&
    canExit.size === region.nodes.length &&
    isAcyclic(edges)
  );
};
