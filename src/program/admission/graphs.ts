import type {
  ProgramModule,
  ProgramNode,
  ProgramNodeId,
  ProgramRegion,
} from '../contracts/index.js';

export type ModuleCallEdge = { readonly from: string; readonly to: string };

export const hasValidCallGraph = (
  modules: ReadonlyMap<string, ProgramModule>,
  edges: readonly ModuleCallEdge[],
): boolean => {
  const outgoing = new Map<string, string[]>([...modules.keys()].map((key) => [key, []]));
  const indegree = new Map<string, number>([...modules.keys()].map((key) => [key, 0]));
  for (const { from, to } of edges) {
    outgoing.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const depths = new Map<string, number>([...modules.keys()].map((key) => [key, 0]));
  const pending = [...indegree].filter(([, degree]) => degree === 0).map(([key]) => key);
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    visited += 1;
    for (const target of outgoing.get(current) ?? []) {
      const depth = (depths.get(current) ?? 0) + 1;
      depths.set(target, Math.max(depths.get(target) ?? 0, depth));
      const degree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, degree);
      if (degree === 0) {
        pending.push(target);
      }
    }
  }
  return visited === modules.size;
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
  const indegree = new Map<ProgramNodeId, number>([...edges.keys()].map((key) => [key, 0]));
  for (const targets of edges.values()) {
    for (const target of targets) {
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }
  const pending = [...indegree].filter(([, degree]) => degree === 0).map(([key]) => key);
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    visited += 1;
    for (const target of edges.get(current) ?? []) {
      const degree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, degree);
      if (degree === 0) {
        pending.push(target);
      }
    }
  }
  return visited === edges.size;
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
