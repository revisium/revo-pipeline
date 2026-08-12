import {
  appendJsonPointer,
  type DiagnosticCollector,
  type JsonPointer,
  type JsonScalar,
} from '../../foundation/index.js';
import {
  PipelineFailureValueSchema,
  type ChoiceDomain,
  type ChoiceSourceNode,
  type RepeatCondition,
  type SourceNode,
  type ValueMapping,
  type ValueSchema,
  type ValueSelector,
} from '../contracts/index.js';
import { nestedPath } from '../internal.js';
import { casesCoverFiniteDomain, projectValueSchema } from '../value-schema/index.js';
import {
  literalValueSchema,
  mapItemsSchema,
  sourceNodeOutputSchema,
  type MapItemsSchema,
} from './derived-schema.js';

export type SelectorEnvironment = {
  readonly moduleInput: ValueSchema;
  readonly scopeInput: ValueSchema;
  readonly nodes: ReadonlyMap<string, SourceNode>;
  readonly resolutionState: SelectorResolutionState;
  readonly repeat?: {
    readonly iteration: ValueSchema;
    readonly previousOutput: ValueSchema;
  };
  readonly map?: { readonly item: ValueSchema; readonly itemKey: ValueSchema };
  readonly regionOutput?: ValueSchema;
};

type SelectorSchemaResolution =
  | { readonly ok: true; readonly schema: ValueSchema }
  | { readonly ok: false; readonly reason: 'pointer' | 'schema' | 'scope' };

type MapNode = Extract<SourceNode, { readonly kind: 'map' }>;

type MapItemsSchemaResolution =
  | { readonly ok: true; readonly value: MapItemsSchema }
  | { readonly ok: false; readonly reason: 'pointer' | 'schema' | 'scope' };

export type SelectorResolutionState = {
  readonly nodeOutputs: Map<SourceNode, SelectorSchemaResolution>;
  readonly mapItems: Map<MapNode, MapItemsSchemaResolution>;
};

export const createSelectorResolutionState = (): SelectorResolutionState => ({
  nodeOutputs: new Map(),
  mapItems: new Map(),
});

const mappingSelectors = (
  mapping: ValueMapping,
  path: JsonPointer,
): readonly (readonly [ValueSelector, JsonPointer])[] =>
  Object.entries(mapping).map(
    ([key, selector]) => [selector, appendJsonPointer(path, key)] as const,
  );

const conditionSelectors = (
  condition: RepeatCondition,
  path: JsonPointer,
): readonly (readonly [ValueSelector, JsonPointer])[] => {
  if (condition.kind === 'all' || condition.kind === 'any') {
    return condition.conditions.flatMap((nested, index) =>
      conditionSelectors(nested, nestedPath(path, 'conditions', String(index))),
    );
  }
  if (condition.kind === 'not') {
    return conditionSelectors(condition.condition, appendJsonPointer(path, 'condition'));
  }
  return [[condition.selector, appendJsonPointer(path, 'selector')]];
};

const validateSelectorContext = (
  selector: ValueSelector,
  path: JsonPointer,
  environment: SelectorEnvironment,
  collector: DiagnosticCollector,
): void => {
  if (selector.kind === 'regionOutput' && environment.regionOutput === undefined) {
    collector.add('DATA_SCOPE', path);
  }
  if (selector.kind === 'repeat' && environment.repeat === undefined) {
    collector.add('DATA_SCOPE', path);
  }
  if (selector.kind === 'map' && environment.map === undefined) {
    collector.add('DATA_SCOPE', path);
  }
  if (
    (selector.kind === 'nodeOutput' || selector.kind === 'nodeFailure') &&
    !environment.nodes.has(selector.node)
  ) {
    collector.add('DATA_SCOPE', appendJsonPointer(path, 'node'));
  }
};

export const validateSelectors = (
  selectors: readonly (readonly [ValueSelector, JsonPointer])[],
  environment: SelectorEnvironment,
  collector: DiagnosticCollector,
): void => {
  for (const [selector, path] of selectors) {
    validateSelectorContext(selector, path, environment, collector);
  }
};

const resolvedSchema = (schema: ValueSchema): SelectorSchemaResolution => ({ ok: true, schema });

const unavailableSelector = (): Extract<SelectorSchemaResolution, { readonly ok: false }> => ({
  ok: false,
  reason: 'scope',
});

const optionalSchema = (schema: ValueSchema | undefined): SelectorSchemaResolution =>
  schema === undefined ? unavailableSelector() : resolvedSchema(schema);

const nodeOutputBaseSchema = (
  nodeKey: string,
  environment: SelectorEnvironment,
): SelectorSchemaResolution => {
  const node = environment.nodes.get(nodeKey);
  if (node === undefined) {
    return unavailableSelector();
  }
  const cached = environment.resolutionState.nodeOutputs.get(node);
  if (cached !== undefined) {
    return cached;
  }
  const result =
    node.kind === 'map'
      ? (() => {
          const mapItems = resolveMapItemsSchema(node, environment);
          return mapItems.ok
            ? optionalSchema(sourceNodeOutputSchema(node, mapItems.value) ?? undefined)
            : mapItems;
        })()
      : optionalSchema(sourceNodeOutputSchema(node) ?? undefined);
  environment.resolutionState.nodeOutputs.set(node, result);
  return result;
};

const repeatBaseSchema = (
  selector: Extract<ValueSelector, { readonly kind: 'repeat' }>,
  environment: SelectorEnvironment,
): SelectorSchemaResolution => {
  if (environment.repeat === undefined) {
    return unavailableSelector();
  }
  return resolvedSchema(
    selector.value === 'iteration'
      ? environment.repeat.iteration
      : environment.repeat.previousOutput,
  );
};

const mapBaseSchema = (
  selector: Extract<ValueSelector, { readonly kind: 'map' }>,
  environment: SelectorEnvironment,
): SelectorSchemaResolution => {
  if (environment.map === undefined) {
    return unavailableSelector();
  }
  return resolvedSchema(selector.value === 'item' ? environment.map.item : environment.map.itemKey);
};

const selectorBaseSchema = (
  selector: ValueSelector,
  environment: SelectorEnvironment,
): SelectorSchemaResolution => {
  switch (selector.kind) {
    case 'literal':
      return resolvedSchema(literalValueSchema(selector.value));
    case 'moduleInput':
      return resolvedSchema(environment.moduleInput);
    case 'scopeInput':
      return resolvedSchema(environment.scopeInput);
    case 'regionOutput':
      return optionalSchema(environment.regionOutput);
    case 'nodeFailure':
      return environment.nodes.has(selector.node)
        ? resolvedSchema(PipelineFailureValueSchema)
        : unavailableSelector();
    case 'nodeOutput':
      return nodeOutputBaseSchema(selector.node, environment);
    case 'repeat':
      return repeatBaseSchema(selector, environment);
    case 'map':
      return mapBaseSchema(selector, environment);
  }
  throw new TypeError('Unexpected schema-validated selector.');
};

const resolveSelectorSchema = (
  selector: ValueSelector,
  environment: SelectorEnvironment,
): SelectorSchemaResolution => {
  const base = selectorBaseSchema(selector, environment);
  if (!base.ok || selector.kind === 'literal') {
    return base;
  }
  const projected = projectValueSchema(base.schema, selector.pointer);
  return projected === null ? { ok: false, reason: 'pointer' } : { ok: true, schema: projected };
};

const mapOutputDependency = (
  node: MapNode,
  environment: SelectorEnvironment,
): MapNode | undefined => {
  if (node.items.kind !== 'nodeOutput') {
    return undefined;
  }
  const dependency = environment.nodes.get(node.items.node);
  return dependency?.kind === 'map' ? dependency : undefined;
};

const cacheMapResolution = (
  nodes: readonly MapNode[],
  resolution: Extract<MapItemsSchemaResolution, { readonly ok: false }>,
  environment: SelectorEnvironment,
): void => {
  for (const node of nodes) {
    environment.resolutionState.mapItems.set(node, resolution);
    environment.resolutionState.nodeOutputs.set(node, resolution);
  }
};

const collectMapDependencies = (
  node: MapNode,
  environment: SelectorEnvironment,
): readonly MapNode[] | null => {
  const pending: MapNode[] = [];
  const pendingSet = new Set<MapNode>();
  let current = node;
  while (!environment.resolutionState.mapItems.has(current)) {
    if (pendingSet.has(current)) {
      cacheMapResolution(pending, { ok: false, reason: 'scope' }, environment);
      return null;
    }
    pending.push(current);
    pendingSet.add(current);
    const dependency = mapOutputDependency(current, environment);
    if (dependency === undefined || environment.resolutionState.mapItems.has(dependency)) {
      break;
    }
    current = dependency;
  }
  return pending;
};

const mapItemsResolution = (
  node: MapNode,
  environment: SelectorEnvironment,
): MapItemsSchemaResolution => {
  const resolution = resolveSelectorSchema(node.items, environment);
  if (!resolution.ok) {
    return resolution;
  }
  const items = mapItemsSchema(resolution.schema);
  if (items === null || items.minimumItems > node.maximumItems) {
    return { ok: false, reason: 'schema' };
  }
  return { ok: true, value: items };
};

const resolvePendingMap = (node: MapNode, environment: SelectorEnvironment): void => {
  const result = mapItemsResolution(node, environment);
  environment.resolutionState.mapItems.set(node, result);
  const output = result.ok
    ? optionalSchema(sourceNodeOutputSchema(node, result.value) ?? undefined)
    : result;
  environment.resolutionState.nodeOutputs.set(node, output);
};

const resolveMapItemsSchema = (
  node: MapNode,
  environment: SelectorEnvironment,
): MapItemsSchemaResolution => {
  const cached = environment.resolutionState.mapItems.get(node);
  if (cached !== undefined) {
    return cached;
  }

  const pending = collectMapDependencies(node, environment);
  if (pending === null) {
    return environment.resolutionState.mapItems.get(node) ?? unavailableSelector();
  }
  for (const pendingNode of pending.toReversed()) {
    resolvePendingMap(pendingNode, environment);
  }

  return environment.resolutionState.mapItems.get(node) ?? unavailableSelector();
};

const addSelectorResolutionDiagnostic = (
  selector: ValueSelector,
  path: JsonPointer,
  reason: 'pointer' | 'schema' | 'scope',
  collector: DiagnosticCollector,
): void => {
  if (reason === 'pointer') {
    collector.add('DATA_POINTER_STATIC', appendJsonPointer(path, 'pointer'));
  } else if (reason === 'schema') {
    collector.add('DATA_SCHEMA_INCOMPATIBLE', path);
  } else {
    collector.add(
      'DATA_SCOPE',
      selector.kind === 'nodeOutput' || selector.kind === 'nodeFailure'
        ? appendJsonPointer(path, 'node')
        : path,
    );
  }
};

const selectorSchema = (
  selector: ValueSelector,
  path: JsonPointer,
  environment: SelectorEnvironment,
  collector: DiagnosticCollector,
): ValueSchema | null => {
  const resolution = resolveSelectorSchema(selector, environment);
  if (!resolution.ok) {
    addSelectorResolutionDiagnostic(selector, path, resolution.reason, collector);
    return null;
  }
  return resolution.schema;
};

const domainValues = (domain: ChoiceDomain): readonly JsonScalar[] =>
  domain.kind === 'equals' ? [domain.value] : domain.values;

export const validateChoice = (
  node: ChoiceSourceNode,
  path: JsonPointer,
  environment: SelectorEnvironment,
  collector: DiagnosticCollector,
): void => {
  const seen = new Set<string>();
  for (const choiceCase of node.cases) {
    const local = new Set<string>();
    for (const value of domainValues(choiceCase.when)) {
      const key = `${typeof value}:${JSON.stringify(value)}`;
      if (local.has(key)) {
        continue;
      }
      local.add(key);
      if (seen.has(key)) {
        collector.add('CANONICAL_INPUT', appendJsonPointer(path, 'cases'));
      }
      seen.add(key);
    }
  }
  if (node.otherwise !== null) {
    validateSelectorContext(
      node.selector,
      appendJsonPointer(path, 'selector'),
      environment,
      collector,
    );
    return;
  }
  const schema = selectorSchema(
    node.selector,
    appendJsonPointer(path, 'selector'),
    environment,
    collector,
  );
  if (
    schema !== null &&
    !casesCoverFiniteDomain(
      schema,
      node.cases.map(({ when }) => when),
    )
  ) {
    collector.add('DATA_SCHEMA_INCOMPATIBLE', appendJsonPointer(path, 'otherwise'));
  }
};

export const bodyEnvironment = (
  environment: SelectorEnvironment,
  node: SourceNode,
  collector: DiagnosticCollector,
  path: JsonPointer,
): SelectorEnvironment => {
  if (node.kind === 'repeat') {
    return {
      ...environment,
      repeat: {
        iteration: Object.freeze({
          type: 'integer',
          minimum: 0,
          maximum: node.maximumIterations - 1,
        }),
        previousOutput: node.body.outputSchema,
      },
    };
  }
  if (node.kind === 'map') {
    const itemsPath = appendJsonPointer(path, 'items');
    const items = resolveMapItemsSchema(node, environment);
    if (!items.ok) {
      addSelectorResolutionDiagnostic(node.items, itemsPath, items.reason, collector);
      const { map: _map, ...withoutMap } = environment;
      return withoutMap;
    }
    const projectedItemKey = projectValueSchema(items.value.item, node.itemKeyPointer);
    if (projectedItemKey === null) {
      collector.add('DATA_POINTER_STATIC', appendJsonPointer(path, 'itemKeyPointer'));
    }
    const itemKey = projectedItemKey ?? Object.freeze({ type: 'string' } as const);
    return { ...environment, map: { item: items.value.item, itemKey } };
  }
  return environment;
};

export type NodeSelectorGroup = readonly [
  readonly (readonly [ValueSelector, JsonPointer])[],
  'base' | 'child-exit',
];

export const nodeSelectorGroups = (
  node: SourceNode,
  path: JsonPointer,
): readonly NodeSelectorGroup[] => {
  if (
    node.kind === 'agent' ||
    node.kind === 'script' ||
    node.kind === 'effect' ||
    node.kind === 'call'
  ) {
    return [[mappingSelectors(node.input, appendJsonPointer(path, 'input')), 'base']];
  }
  if (node.kind === 'end') {
    return [[mappingSelectors(node.output, appendJsonPointer(path, 'output')), 'base']];
  }
  if (node.kind === 'parallel') {
    return node.branches.map((branch, index) => [
      mappingSelectors(branch.input, nestedPath(path, 'branches', String(index), 'input')),
      'base',
    ]);
  }
  if (node.kind === 'repeat') {
    return [
      [mappingSelectors(node.initialInput, appendJsonPointer(path, 'initialInput')), 'base'],
      [mappingSelectors(node.nextInput, appendJsonPointer(path, 'nextInput')), 'child-exit'],
      [
        conditionSelectors(node.continueWhen, appendJsonPointer(path, 'continueWhen')),
        'child-exit',
      ],
      [mappingSelectors(node.output, appendJsonPointer(path, 'output')), 'child-exit'],
    ];
  }
  if (node.kind === 'map') {
    return [[mappingSelectors(node.bodyInput, appendJsonPointer(path, 'bodyInput')), 'base']];
  }
  return [];
};
