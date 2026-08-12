import {
  addWithinLimit,
  appendJsonPointer,
  createDiagnosticCollector,
  multiplyWithinLimit,
  type JsonPointer,
  type PipelineDiagnostic,
} from '../../foundation/index.js';
import type { ValidatedProfileMaterialization } from '../../materialization/index.js';
import type {
  PipelineSourceModule,
  PipelineSourcePackage,
  SourceNode,
  SourceRegion,
} from '../../source/index.js';
import { indexAgentSelections } from '../dataflow/agent-selections.js';
import { createIndexedDag, reachableFrom } from '../graph/indexed-dag.js';
import type { LinkedSource } from '../linking/index.js';
import { sourceRoutes } from '../source-routes.js';

export type ActivityBoundResult =
  | { readonly ok: true; readonly maximumActivities: number }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

type BoundContext = {
  readonly linked: LinkedSource;
  readonly selectedParticipants: ReadonlyMap<JsonPointer, number>;
  readonly collector: ReturnType<typeof createDiagnosticCollector>;
  readonly moduleBounds: Map<PipelineSourceModule, number | null>;
  readonly modulePaths: ReadonlyMap<PipelineSourceModule, JsonPointer>;
};

const safeAdd = (
  left: number,
  right: number,
  path: JsonPointer,
  context: BoundContext,
): number | null => {
  const result = addWithinLimit(left, right, Number.MAX_SAFE_INTEGER);
  if (result === null) {
    context.collector.add('BOUND_OVERFLOW', path);
  }
  return result;
};

const safeMultiply = (
  left: number,
  right: number,
  path: JsonPointer,
  context: BoundContext,
): number | null => {
  const result = multiplyWithinLimit(left, right, Number.MAX_SAFE_INTEGER);
  if (result === null) {
    context.collector.add('BOUND_OVERFLOW', path);
  }
  return result;
};

const sum = (
  values: readonly (number | null)[],
  path: JsonPointer,
  context: BoundContext,
): number | null => {
  let total = 0;
  for (const value of values) {
    if (value === null) {
      return null;
    }
    const next = safeAdd(total, value, path, context);
    if (next === null) {
      return null;
    }
    total = next;
  }
  return total;
};

const regionBound = (
  region: SourceRegion,
  path: JsonPointer,
  context: BoundContext,
): number | null => {
  const paths = region.nodes.map((_, index) =>
    appendJsonPointer(appendJsonPointer(path, 'nodes'), String(index)),
  );
  const routes = region.nodes.map((node, index) => {
    const nodePath = paths[index] ?? path;
    const selectedStrategy =
      node.kind === 'agent'
        ? node.strategies.find(({ kind }) =>
            context.selectedParticipants.has(nodePath) ? kind === 'consensus' : kind === 'single',
          )
        : undefined;
    return sourceRoutes(node, selectedStrategy);
  });
  const graph = createIndexedDag(
    region.nodes.map(({ key }) => key),
    routes.map((outgoing) => outgoing.map(({ target }) => target)),
  );
  const entryIndex = graph.indexByKey.get(region.entry);
  if (entryIndex === undefined) {
    return null;
  }
  const reachable = reachableFrom(graph, entryIndex);
  const bounds = new Array<number | null>(region.nodes.length).fill(null);
  for (let orderIndex = graph.topologicalOrder.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const nodeIndex = graph.topologicalOrder[orderIndex];
    const node = nodeIndex === undefined ? undefined : region.nodes[nodeIndex];
    const nodePath = nodeIndex === undefined ? path : (paths[nodeIndex] ?? path);
    if (nodeIndex === undefined || node === undefined) {
      return null;
    }
    if (reachable[nodeIndex] === 0) {
      continue;
    }
    const local = nodeBound(node, nodePath, context);
    let continuation: number | null = 0;
    for (const targetIndex of graph.outgoing[nodeIndex] ?? []) {
      const targetBound = bounds[targetIndex];
      if (targetBound === null || targetBound === undefined) {
        continuation = null;
        break;
      }
      continuation = Math.max(continuation, targetBound);
    }
    bounds[nodeIndex] =
      local === null || continuation === null
        ? null
        : safeAdd(local, continuation, nodePath, context);
  }

  return bounds[entryIndex] ?? null;
};

const callBound = (path: JsonPointer, context: BoundContext): number | null => {
  const target = context.linked.callsByPath.get(path)?.target;
  if (target === undefined) {
    return null;
  }
  if (context.moduleBounds.has(target)) {
    return context.moduleBounds.get(target) ?? null;
  }
  const modulePath = context.modulePaths.get(target);
  if (modulePath === undefined) {
    return null;
  }
  const result = regionBound(target.region, modulePath, context);
  context.moduleBounds.set(target, result);
  return result;
};

const nodeBound = (node: SourceNode, path: JsonPointer, context: BoundContext): number | null => {
  switch (node.kind) {
    case 'agent':
      return context.selectedParticipants.get(path) ?? 1;
    case 'script':
    case 'effect':
      return 1;
    case 'call':
      return callBound(path, context);
    case 'parallel':
      return sum(
        node.branches.map((branch, index) =>
          regionBound(branch.region, `${path}/branches/${index}/region`, context),
        ),
        path,
        context,
      );
    case 'consensus':
      return node.participants.length;
    case 'repeat': {
      const body = regionBound(node.body, `${path}/body`, context);
      return body === null ? null : safeMultiply(body, node.maximumIterations, path, context);
    }
    case 'map': {
      const body = regionBound(node.body, `${path}/body`, context);
      return body === null ? null : safeMultiply(body, node.maximumItems, path, context);
    }
    case 'choice':
    case 'wait':
    case 'humanGate':
    case 'end':
      return 0;
  }
  throw new TypeError('Unexpected schema-validated source node.');
};

export const proveActivityBound = (
  source: PipelineSourcePackage,
  materialization: ValidatedProfileMaterialization,
  linked: LinkedSource,
): ActivityBoundResult => {
  const collector = createDiagnosticCollector();
  const selectedParticipants = new Map<JsonPointer, number>();
  for (const [path, { slot }] of indexAgentSelections(materialization)) {
    if (slot.selection.strategy === 'consensus') {
      selectedParticipants.set(path, slot.selection.participants.length);
    }
  }
  const context: BoundContext = {
    linked,
    selectedParticipants,
    collector,
    moduleBounds: new Map(),
    modulePaths: new Map(
      source.modules.map((module, index) => [module, `/modules/${index}/region`]),
    ),
  };
  const entry = linked.modulesByKey.get(source.entryModule);
  const entryPath = entry === undefined ? undefined : context.modulePaths.get(entry);
  const maximumActivities =
    entry === undefined || entryPath === undefined
      ? null
      : regionBound(entry.region, entryPath, context);
  if (maximumActivities !== null && maximumActivities > source.maximumTotalActivities) {
    collector.add('BOUND_EXCEEDED', '/maximumTotalActivities');
  }
  const diagnostics = collector.finalize();
  return diagnostics.length > 0 || maximumActivities === null
    ? { ok: false, diagnostics }
    : { ok: true, maximumActivities };
};
