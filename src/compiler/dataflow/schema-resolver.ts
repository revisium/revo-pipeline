import {
  PipelineFailureValueSchema,
  appendJsonPointer,
  projectValueSchema,
  type DiagnosticCollector,
  type JsonPointer,
  type ValueSchema,
} from '../../foundation/index.js';
import { voteParallelOutputSchema } from '../../program/index.js';
import {
  literalValueSchema,
  mapItemsSchema,
  sourceNodeOutputSchema,
  type MapItemsSchema,
  type SourceNode,
  type ValueSelector,
} from '../../source/index.js';
import type { MaterializedAgentSelection } from './agent-selections.js';
import type { RegionRouteFacts } from './route-graph.js';

export type SelectorEnvironment = {
  readonly moduleInput: ValueSchema;
  readonly scopeInput: ValueSchema;
  readonly repeat?: {
    readonly iteration: ValueSchema;
    readonly previousOutput: ValueSchema;
  };
  readonly map?: { readonly item: ValueSchema; readonly itemKey: ValueSchema };
  readonly regionOutput?: ValueSchema;
};

export type SchemaResolver = {
  readonly selector: (
    selector: ValueSelector,
    path: JsonPointer,
    consumerKey: string,
    environment?: SelectorEnvironment,
  ) => ValueSchema | null;
  readonly mapItems: (node: Extract<SourceNode, { readonly kind: 'map' }>) => MapItemsSchema | null;
};

export type SchemaResolverInput = {
  readonly environment: SelectorEnvironment;
  readonly facts: RegionRouteFacts;
  readonly nodePaths: ReadonlyMap<string, JsonPointer>;
  readonly agentSelections: ReadonlyMap<JsonPointer, MaterializedAgentSelection>;
  readonly collector: DiagnosticCollector;
};

const projectSelector = (
  schema: ValueSchema,
  selector: Exclude<ValueSelector, { readonly kind: 'literal' }>,
  path: JsonPointer,
  collector: DiagnosticCollector,
): ValueSchema | null => {
  const projected = projectValueSchema(schema, selector.pointer);
  if (projected === null) {
    collector.add('DATA_POINTER_STATIC', appendJsonPointer(path, 'pointer'));
  }
  return projected;
};

const unavailable = (
  selector: ValueSelector,
  path: JsonPointer,
  collector: DiagnosticCollector,
): null => {
  collector.add(
    'DATA_SCOPE',
    selector.kind === 'nodeOutput' || selector.kind === 'nodeFailure'
      ? appendJsonPointer(path, 'node')
      : path,
  );
  return null;
};

const statusSchema = (
  selector: Extract<ValueSelector, { readonly kind: 'nodeOutput' | 'nodeFailure' }>,
  consumerKey: string,
  facts: RegionRouteFacts,
  resolveOutput: (node: SourceNode) => ValueSchema | null,
  path: JsonPointer,
  collector: DiagnosticCollector,
): ValueSchema | null => {
  const producer = facts.nodesByKey.get(selector.node);
  if (producer === undefined) {
    return unavailable(selector, path, collector);
  }
  const status = selector.kind === 'nodeOutput' ? 'succeeded' : 'failed';
  if (!facts.statusDominates(producer.id, consumerKey, status)) {
    collector.add('DATA_DOMINANCE', path);
    return null;
  }
  return selector.kind === 'nodeFailure' ? PipelineFailureValueSchema : resolveOutput(producer);
};

type ResolutionState = {
  readonly outputCache: Map<SourceNode, ValueSchema | null>;
  readonly mapItemsCache: Map<Extract<SourceNode, { readonly kind: 'map' }>, MapItemsSchema | null>;
};

type MapNode = Extract<SourceNode, { readonly kind: 'map' }>;

const mapOutputDependency = (node: MapNode, input: SchemaResolverInput): MapNode | undefined => {
  if (node.items.kind !== 'nodeOutput') {
    return undefined;
  }
  const dependency = input.facts.nodesByKey.get(node.items.node);
  return dependency?.kind === 'map' &&
    input.facts.statusDominates(dependency.id, node.id, 'succeeded')
    ? dependency
    : undefined;
};

const cacheUnresolvableMaps = (pending: readonly MapNode[], state: ResolutionState): void => {
  for (const node of pending) {
    state.mapItemsCache.set(node, null);
    state.outputCache.set(node, null);
  }
};

const collectMapDependencies = (
  node: MapNode,
  input: SchemaResolverInput,
  state: ResolutionState,
): readonly MapNode[] | null => {
  const pending: MapNode[] = [];
  const pendingSet = new Set<MapNode>();
  let current = node;
  while (!state.mapItemsCache.has(current)) {
    if (pendingSet.has(current)) {
      cacheUnresolvableMaps(pending, state);
      return null;
    }
    pending.push(current);
    pendingSet.add(current);
    const dependency = mapOutputDependency(current, input);
    if (dependency === undefined || state.mapItemsCache.has(dependency)) {
      break;
    }
    current = dependency;
  }
  return pending;
};

const resolvePendingMap = (
  node: MapNode,
  input: SchemaResolverInput,
  state: ResolutionState,
): void => {
  const path = input.nodePaths.get(node.id) ?? '';
  const schema = resolveSelector(
    node.items,
    appendJsonPointer(path, 'items'),
    node.id,
    input,
    state,
  );
  const items = schema === null ? null : mapItemsSchema(schema);
  if (schema !== null && (items === null || items.minimumItems > node.maximumItems)) {
    input.collector.add('DATA_SCHEMA_INCOMPATIBLE', appendJsonPointer(path, 'items'));
  }
  const result = items === null || items.minimumItems > node.maximumItems ? null : items;
  state.mapItemsCache.set(node, result);
  state.outputCache.set(node, result === null ? null : sourceNodeOutputSchema(node, result));
};

const resolveMapItems = (
  node: MapNode,
  input: SchemaResolverInput,
  state: ResolutionState,
): MapItemsSchema | null => {
  if (state.mapItemsCache.has(node)) {
    return state.mapItemsCache.get(node) ?? null;
  }

  const pending = collectMapDependencies(node, input, state);
  if (pending === null) {
    return null;
  }
  for (const pendingNode of pending.toReversed()) {
    resolvePendingMap(pendingNode, input, state);
  }

  return state.mapItemsCache.get(node) ?? null;
};

const uncachedNodeOutput = (
  node: SourceNode,
  input: SchemaResolverInput,
  state: ResolutionState,
): ValueSchema | null => {
  const path = input.nodePaths.get(node.id) ?? '';
  if (node.kind === 'agent') {
    const selected = input.agentSelections.get(path)?.slot.selection;
    if (selected?.strategy === 'single') {
      return node.outputSchema;
    }
    if (selected?.strategy === 'consensus') {
      return voteParallelOutputSchema(selected.participants.map(({ key }) => key));
    }
    return null;
  }
  if (node.kind === 'map') {
    const items = resolveMapItems(node, input, state);
    return items === null ? null : sourceNodeOutputSchema(node, items);
  }
  return sourceNodeOutputSchema(node);
};

const resolveNodeOutput = (
  node: SourceNode,
  input: SchemaResolverInput,
  state: ResolutionState,
): ValueSchema | null => {
  if (state.outputCache.has(node)) {
    return state.outputCache.get(node) ?? null;
  }
  const schema = uncachedNodeOutput(node, input, state);
  state.outputCache.set(node, schema);
  return schema;
};

const baseSchema = (
  selector: ValueSelector,
  path: JsonPointer,
  consumerKey: string,
  environment: SelectorEnvironment,
  input: SchemaResolverInput,
  state: ResolutionState,
): ValueSchema | null => {
  switch (selector.kind) {
    case 'literal':
      return literalValueSchema(selector.value);
    case 'moduleInput':
      return environment.moduleInput;
    case 'scopeInput':
      return environment.scopeInput;
    case 'regionOutput':
      return environment.regionOutput ?? unavailable(selector, path, input.collector);
    case 'repeat':
      return environment.repeat?.[selector.value] ?? unavailable(selector, path, input.collector);
    case 'map':
      return environment.map?.[selector.value] ?? unavailable(selector, path, input.collector);
    case 'nodeOutput':
    case 'nodeFailure':
      return statusSchema(
        selector,
        consumerKey,
        input.facts,
        (node) => resolveNodeOutput(node, input, state),
        path,
        input.collector,
      );
  }
  throw new TypeError('Unexpected schema-validated selector.');
};

const resolveSelector = (
  selector: ValueSelector,
  path: JsonPointer,
  consumerKey: string,
  input: SchemaResolverInput,
  state: ResolutionState,
  environment: SelectorEnvironment = input.environment,
): ValueSchema | null => {
  const base = baseSchema(selector, path, consumerKey, environment, input, state);
  return base === null || selector.kind === 'literal'
    ? base
    : projectSelector(base, selector, path, input.collector);
};

export const createSchemaResolver = (input: SchemaResolverInput): SchemaResolver => {
  const state: ResolutionState = {
    outputCache: new Map(),
    mapItemsCache: new Map(),
  };
  return Object.freeze({
    selector: (selector, path, consumerKey, environment) =>
      resolveSelector(selector, path, consumerKey, input, state, environment),
    mapItems: (node) => resolveMapItems(node, input, state),
  });
};
