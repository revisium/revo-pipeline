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

const selectorBaseSchema = (
  selector: ValueSelector,
  environment: SelectorEnvironment,
  resolvingMaps: ReadonlySet<SourceNode>,
): SelectorSchemaResolution => {
  switch (selector.kind) {
    case 'literal':
      return { ok: true, schema: literalValueSchema(selector.value) };
    case 'moduleInput':
      return { ok: true, schema: environment.moduleInput };
    case 'scopeInput':
      return { ok: true, schema: environment.scopeInput };
    case 'regionOutput':
      return environment.regionOutput === undefined
        ? { ok: false, reason: 'scope' }
        : { ok: true, schema: environment.regionOutput };
    case 'nodeFailure':
      return environment.nodes.has(selector.node)
        ? { ok: true, schema: PipelineFailureValueSchema }
        : { ok: false, reason: 'scope' };
    case 'nodeOutput': {
      const node = environment.nodes.get(selector.node);
      if (node === undefined || resolvingMaps.has(node)) {
        return { ok: false, reason: 'scope' };
      }
      if (node.kind === 'map') {
        const nextResolving = new Set(resolvingMaps).add(node);
        const mapItems = resolveMapItemsSchema(node, environment, nextResolving);
        if (!mapItems.ok) {
          return mapItems;
        }
        const schema = sourceNodeOutputSchema(node, mapItems.value);
        return schema === null ? { ok: false, reason: 'scope' } : { ok: true, schema };
      }
      const schema = sourceNodeOutputSchema(node);
      return schema === null ? { ok: false, reason: 'scope' } : { ok: true, schema };
    }
    case 'repeat':
      if (environment.repeat === undefined) {
        return { ok: false, reason: 'scope' };
      }
      return {
        ok: true,
        schema:
          selector.value === 'iteration'
            ? environment.repeat.iteration
            : environment.repeat.previousOutput,
      };
    case 'map':
      if (environment.map === undefined) {
        return { ok: false, reason: 'scope' };
      }
      return {
        ok: true,
        schema: selector.value === 'item' ? environment.map.item : environment.map.itemKey,
      };
  }
  throw new TypeError('Unexpected schema-validated selector.');
};

const resolveSelectorSchema = (
  selector: ValueSelector,
  environment: SelectorEnvironment,
  resolvingMaps: ReadonlySet<SourceNode> = new Set(),
): SelectorSchemaResolution => {
  const base = selectorBaseSchema(selector, environment, resolvingMaps);
  if (!base.ok || selector.kind === 'literal') {
    return base;
  }
  const projected = projectValueSchema(base.schema, selector.pointer);
  return projected === null ? { ok: false, reason: 'pointer' } : { ok: true, schema: projected };
};

type MapItemsSchemaResolution =
  | { readonly ok: true; readonly value: MapItemsSchema }
  | { readonly ok: false; readonly reason: 'pointer' | 'schema' | 'scope' };

const resolveMapItemsSchema = (
  node: Extract<SourceNode, { readonly kind: 'map' }>,
  environment: SelectorEnvironment,
  resolvingMaps: ReadonlySet<SourceNode> = new Set([node]),
): MapItemsSchemaResolution => {
  const resolution = resolveSelectorSchema(node.items, environment, resolvingMaps);
  if (!resolution.ok) {
    return resolution;
  }
  const items = mapItemsSchema(resolution.schema);
  return items === null || items.minimumItems > node.maximumItems
    ? { ok: false, reason: 'schema' }
    : { ok: true, value: items };
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
