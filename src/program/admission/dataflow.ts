import {
  PipelineFailureValueSchema,
  canonicalizeOwnedValue,
  casesCoverFiniteDomain,
  compareUnicodeCodePoints,
  projectValueSchema,
  valueSchemaIsCompatible,
  type JsonScalar,
  type JsonValue,
  type ValueSchema,
} from '../../foundation/index.js';
import type {
  ProgramMapNode,
  ProgramModule,
  ProgramNode,
  ProgramNodeId,
  ProgramRegion,
  ProgramRepeatCondition,
  ProgramValueMapping,
  ProgramValueSelector,
} from '../contracts/index.js';
import {
  genericParallelOutputSchema,
  humanGateOutputSchema,
  voteParallelOutputSchema,
} from '../derived-schemas.js';

type RouteStatus = 'succeeded' | 'failed' | 'cancelled' | 'neutral';
type RouteEdge = { readonly target: ProgramNodeId; readonly status: RouteStatus };

type SelectorEnvironment = {
  readonly moduleInput: ValueSchema;
  readonly scopeInput: ValueSchema;
  readonly repeat?: {
    readonly iteration: ValueSchema;
    readonly previousOutput: ValueSchema;
  };
  readonly map?: { readonly item: ValueSchema; readonly itemKey: ValueSchema };
  readonly regionOutput?: ValueSchema;
};

type RegionFacts = {
  readonly nodesById: ReadonlyMap<ProgramNodeId, ProgramNode>;
  readonly statusDominates: (
    producer: ProgramNodeId,
    consumer: ProgramNodeId,
    status: 'succeeded' | 'failed',
  ) => boolean;
};

type MapItemsSchema = {
  readonly item: ValueSchema;
  readonly minimumItems: number;
  readonly maximumItems?: number;
};

type ResolutionState = {
  readonly nodeOutputs: Map<ProgramNode, ValueSchema | null>;
  readonly mapItems: Map<ProgramMapNode, MapItemsSchema | null>;
  readonly resolvingMaps: Set<ProgramMapNode>;
};

type RegionContext = {
  readonly environment: SelectorEnvironment;
  readonly facts: RegionFacts;
  readonly modules: ReadonlyMap<string, ProgramModule>;
  readonly state: ResolutionState;
  readonly validateChild: (region: ProgramRegion, environment: SelectorEnvironment) => boolean;
};

const programRoutes = (node: ProgramNode): readonly RouteEdge[] => {
  switch (node.kind) {
    case 'activity':
      return [
        { target: node.routes.succeeded, status: 'succeeded' },
        { target: node.routes.failed, status: 'failed' },
        { target: node.routes.cancelled, status: 'cancelled' },
      ];
    case 'choice':
      return [
        ...node.cases.map(({ target }) => ({ target, status: 'neutral' as const })),
        ...(node.otherwise === null
          ? []
          : [{ target: node.otherwise, status: 'neutral' as const }]),
      ];
    case 'call':
      return [
        ...node.routes.outcomes.map(({ target }) => ({ target, status: 'succeeded' as const })),
        { target: node.routes.failed, status: 'failed' },
        { target: node.routes.cancelled, status: 'cancelled' },
      ];
    case 'parallel':
      return [{ target: node.next, status: 'succeeded' }];
    case 'repeat':
      return [
        { target: node.routes.completed, status: 'succeeded' },
        { target: node.routes.exhausted, status: 'succeeded' },
        { target: node.routes.failed, status: 'failed' },
        { target: node.routes.cancelled, status: 'cancelled' },
      ];
    case 'map':
      return [
        { target: node.routes.completed, status: 'succeeded' },
        { target: node.routes.failed, status: 'failed' },
        { target: node.routes.cancelled, status: 'cancelled' },
      ];
    case 'wait':
      return [
        { target: node.routes.completed, status: 'succeeded' },
        { target: node.routes.cancelled, status: 'cancelled' },
      ];
    case 'humanGate':
      return [
        ...node.routes.answers.map(({ target }) => ({ target, status: 'succeeded' as const })),
        { target: node.routes.conflict, status: 'succeeded' },
        { target: node.routes.deadline, status: 'succeeded' },
        { target: node.routes.cancelled, status: 'cancelled' },
      ];
    case 'end':
      return [];
  }
  node satisfies never;
  return [];
};

const bitIsSet = (bits: Uint32Array, index: number): boolean =>
  ((bits[index >>> 5] ?? 0) & (1 << (index & 31))) !== 0;

const setBit = (bits: Uint32Array, index: number): void => {
  const wordIndex = index >>> 5;
  bits[wordIndex] = (bits[wordIndex] ?? 0) | (1 << (index & 31));
};

const intersectBits = (target: Uint32Array, other: Uint32Array): void => {
  for (let index = 0; index < target.length; index += 1) {
    target[index] = (target[index] ?? 0) & (other[index] ?? 0);
  }
};

const includeBits = (target: Uint32Array, other: Uint32Array): void => {
  for (let index = 0; index < target.length; index += 1) {
    target[index] = (target[index] ?? 0) | (other[index] ?? 0);
  }
};

const requiredBits = (rows: readonly Uint32Array[], index: number): Uint32Array => {
  const bits = rows[index];
  if (bits === undefined) {
    throw new TypeError('Expected an indexed Program route node.');
  }
  return bits;
};

const buildRegionRouteGraph = (region: ProgramRegion) => {
  const indexById = new Map(region.nodes.map((node, index) => [node.id, index]));
  const routes = region.nodes.map(programRoutes);
  const outgoing = routes.map((edges) =>
    edges.flatMap(({ target }) => {
      const index = indexById.get(target);
      return index === undefined ? [] : [index];
    }),
  );
  const predecessors = region.nodes.map(() => [] as number[]);
  const indegrees = region.nodes.map(() => 0);
  for (const [from, targets] of outgoing.entries()) {
    for (const target of targets) {
      predecessors[target]?.push(from);
      indegrees[target] = (indegrees[target] ?? 0) + 1;
    }
  }
  const pending = indegrees.flatMap((degree, index) => (degree === 0 ? [index] : []));
  const topologicalOrder: number[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    topologicalOrder.push(current);
    for (const target of outgoing[current] ?? []) {
      const degree = (indegrees[target] ?? 0) - 1;
      indegrees[target] = degree;
      if (degree === 0) {
        pending.push(target);
      }
    }
  }
  return { indexById, routes, outgoing, predecessors, topologicalOrder };
};

const regionFacts = (region: ProgramRegion): RegionFacts => {
  const { indexById, routes, outgoing, predecessors, topologicalOrder } =
    buildRegionRouteGraph(region);

  const wordCount = Math.ceil(region.nodes.length / 32);
  const dominators = region.nodes.map(() => new Uint32Array(wordCount));
  for (const nodeIndex of topologicalOrder) {
    const bits = requiredBits(dominators, nodeIndex);
    const firstPredecessor = predecessors[nodeIndex]?.[0];
    if (firstPredecessor !== undefined) {
      bits.set(requiredBits(dominators, firstPredecessor));
      for (const predecessor of predecessors[nodeIndex]?.slice(1) ?? []) {
        intersectBits(bits, requiredBits(dominators, predecessor));
      }
    }
    setBit(bits, nodeIndex);
  }

  const reachable = region.nodes.map(() => new Uint32Array(wordCount));
  for (const nodeIndex of topologicalOrder.toReversed()) {
    const bits = requiredBits(reachable, nodeIndex);
    setBit(bits, nodeIndex);
    for (const target of outgoing[nodeIndex] ?? []) {
      includeBits(bits, requiredBits(reachable, target));
    }
  }

  return Object.freeze({
    nodesById: new Map(region.nodes.map((node) => [node.id, node])),
    statusDominates: (producerId, consumerId, status) => {
      const producer = indexById.get(producerId);
      const consumer = indexById.get(consumerId);
      if (
        producer === undefined ||
        consumer === undefined ||
        !bitIsSet(requiredBits(dominators, consumer), producer)
      ) {
        return false;
      }
      let reachesConsumer = false;
      for (const edge of routes[producer] ?? []) {
        const target = indexById.get(edge.target);
        if (target !== undefined && bitIsSet(requiredBits(reachable, target), consumer)) {
          reachesConsumer = true;
          if (edge.status !== status) {
            return false;
          }
        }
      }
      return reachesConsumer;
    },
  });
};

const schemaUnion = (schemas: readonly ValueSchema[]): ValueSchema | null => {
  const unique = new Map(
    schemas.map((schema) => [canonicalizeOwnedValue(schema).text, schema] as const),
  );
  const [first, second, ...rest] = [...unique.values()];
  if (first === undefined) {
    return null;
  }
  if (second === undefined) {
    return first;
  }
  const alternatives: [ValueSchema, ValueSchema, ...ValueSchema[]] = [first, second, ...rest];
  return Object.freeze({ anyOf: Object.freeze(alternatives) });
};

const stringEnum = (...values: readonly string[]): ValueSchema =>
  Object.freeze({
    type: 'string',
    enum: Object.freeze([...new Set(values)].sort(compareUnicodeCodePoints)),
  });

const closedObject = (properties: Readonly<Record<string, ValueSchema>>): ValueSchema => {
  const entries = Object.entries(properties).sort(([left], [right]) =>
    compareUnicodeCodePoints(left, right),
  );
  return Object.freeze({
    type: 'object',
    properties: Object.freeze(Object.fromEntries(entries)),
    required: Object.freeze(entries.map(([key]) => key)),
    additionalProperties: false,
  });
};

const isJsonObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const literalValueSchema = (value: JsonValue): ValueSchema => {
  if (value === null) {
    return Object.freeze({ type: 'null' });
  }
  if (typeof value === 'boolean') {
    return Object.freeze({ type: 'boolean' });
  }
  if (typeof value === 'number') {
    return Object.freeze({ type: 'integer', minimum: value, maximum: value });
  }
  if (typeof value === 'string') {
    return stringEnum(value);
  }
  if (Array.isArray(value)) {
    return Object.freeze({
      type: 'array',
      items: schemaUnion(value.map(literalValueSchema)) ?? Object.freeze({ type: 'null' }),
      minItems: value.length,
      maxItems: value.length,
    });
  }
  if (!isJsonObject(value)) {
    throw new TypeError('Expected an admitted JSON value.');
  }
  return closedObject(
    Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, literalValueSchema(nested)]),
    ),
  );
};

const arrayAlternatives = (
  schema: ValueSchema,
): readonly Extract<ValueSchema, { readonly type: 'array' }>[] | null => {
  if ('anyOf' in schema) {
    const alternatives = schema.anyOf.map(arrayAlternatives);
    return alternatives.includes(null)
      ? null
      : alternatives.flatMap((alternative) => alternative ?? []);
  }
  return schema.type === 'array' ? [schema] : null;
};

const mapItemsSchema = (schema: ValueSchema): MapItemsSchema | null => {
  const alternatives = arrayAlternatives(schema);
  if (alternatives === null || alternatives.length === 0) {
    return null;
  }
  const item = schemaUnion(alternatives.map(({ items }) => items));
  if (item === null) {
    return null;
  }
  const maximumItems = alternatives.every(({ maxItems }) => maxItems !== undefined)
    ? Math.max(...alternatives.map(({ maxItems }) => maxItems ?? 0))
    : undefined;
  return Object.freeze({
    item,
    minimumItems: Math.min(...alternatives.map(({ minItems }) => minItems ?? 0)),
    ...(maximumItems === undefined ? {} : { maximumItems }),
  });
};

const programMapOutputSchema = (node: ProgramMapNode, items: MapItemsSchema): ValueSchema => {
  const completedOutputs = node.bodyExits.flatMap(({ outcome, classification }) => {
    if (classification !== 'completed') {
      return [];
    }
    const exit = node.body.exits.find((candidate) => candidate.outcome === outcome);
    return exit === undefined ? [] : [exit.outputSchema];
  });
  const variants: ValueSchema[] = [
    closedObject({
      itemKey: Object.freeze({ type: 'string' }),
      status: stringEnum('failed'),
      output: Object.freeze({ type: 'null' }),
      errorCode: Object.freeze({ type: 'string' }),
    }),
    closedObject({
      itemKey: Object.freeze({ type: 'string' }),
      status: stringEnum('cancelled'),
      output: Object.freeze({ type: 'null' }),
      errorCode: Object.freeze({ type: 'null' }),
    }),
  ];
  const completed = schemaUnion(completedOutputs);
  if (completed !== null) {
    variants.unshift(
      closedObject({
        itemKey: Object.freeze({ type: 'string' }),
        status: stringEnum('succeeded'),
        output: completed,
        errorCode: Object.freeze({ type: 'null' }),
      }),
    );
  }
  const fallback = variants[0];
  if (fallback === undefined) {
    throw new TypeError('Expected a Program map result variant.');
  }
  return closedObject({
    items: Object.freeze({
      type: 'array',
      items: schemaUnion(variants) ?? fallback,
      minItems: items.minimumItems,
      maxItems: Math.min(items.maximumItems ?? node.maximumItems, node.maximumItems),
    }),
  });
};

const resolveMapItems = (node: ProgramMapNode, context: RegionContext): MapItemsSchema | null => {
  if (context.state.mapItems.has(node)) {
    return context.state.mapItems.get(node) ?? null;
  }
  if (context.state.resolvingMaps.has(node)) {
    return null;
  }
  context.state.resolvingMaps.add(node);
  const selected = resolveSelector(node.items, node.id, context);
  const items = selected === null ? null : mapItemsSchema(selected);
  const result = items === null || items.minimumItems > node.maximumItems ? null : items;
  context.state.resolvingMaps.delete(node);
  context.state.mapItems.set(node, result);
  return result;
};

const nodeOutputSchema = (node: ProgramNode, context: RegionContext): ValueSchema | null => {
  if (context.state.nodeOutputs.has(node)) {
    return context.state.nodeOutputs.get(node) ?? null;
  }
  let output: ValueSchema | null;
  switch (node.kind) {
    case 'activity':
    case 'call':
    case 'repeat':
      output = node.outputSchema;
      break;
    case 'parallel':
      output =
        node.mode === 'votes'
          ? voteParallelOutputSchema(node.branches.map(({ key }) => key))
          : genericParallelOutputSchema(
              node.branches.map((branch) => ({
                key: branch.key,
                completed: branch.exits.flatMap(({ outcome, classification }) => {
                  if (classification !== 'qualifies' && classification !== 'doesNotQualify') {
                    return [];
                  }
                  const exit = branch.region.exits.find(
                    (candidate) => candidate.outcome === outcome,
                  );
                  return exit === undefined ? [] : [{ outcome, outputSchema: exit.outputSchema }];
                }),
              })),
            );
      break;
    case 'map': {
      const items = resolveMapItems(node, context);
      output = items === null ? null : programMapOutputSchema(node, items);
      break;
    }
    case 'wait':
      output =
        node.wait.kind === 'signal' && node.wait.payloadSchema !== null
          ? node.wait.payloadSchema
          : Object.freeze({ type: 'null' });
      break;
    case 'humanGate':
      output = humanGateOutputSchema(node.answers);
      break;
    case 'choice':
    case 'end':
      output = null;
      break;
  }
  context.state.nodeOutputs.set(node, output);
  return output;
};

const selectorBaseSchema = (
  selector: ProgramValueSelector,
  consumer: ProgramNodeId,
  context: RegionContext,
  environment: SelectorEnvironment,
): ValueSchema | null => {
  switch (selector.kind) {
    case 'literal':
      return literalValueSchema(selector.value);
    case 'moduleInput':
      return environment.moduleInput;
    case 'scopeInput':
      return environment.scopeInput;
    case 'regionOutput':
      return environment.regionOutput ?? null;
    case 'repeat':
      return environment.repeat?.[selector.value] ?? null;
    case 'map':
      return environment.map?.[selector.value] ?? null;
    case 'nodeOutput':
    case 'nodeFailure': {
      const producer = context.facts.nodesById.get(selector.nodeId);
      const status = selector.kind === 'nodeOutput' ? 'succeeded' : 'failed';
      if (
        producer === undefined ||
        !context.facts.statusDominates(selector.nodeId, consumer, status)
      ) {
        return null;
      }
      return selector.kind === 'nodeFailure'
        ? PipelineFailureValueSchema
        : nodeOutputSchema(producer, context);
    }
  }
  selector satisfies never;
  return null;
};

function resolveSelector(
  selector: ProgramValueSelector,
  consumer: ProgramNodeId,
  context: RegionContext,
  environment: SelectorEnvironment = context.environment,
): ValueSchema | null {
  const base = selectorBaseSchema(selector, consumer, context, environment);
  return base === null || selector.kind === 'literal'
    ? base
    : projectValueSchema(base, selector.pointer);
}

const mappingMatches = (
  mapping: ProgramValueMapping,
  target: ValueSchema,
  consumer: ProgramNodeId,
  context: RegionContext,
  environment: SelectorEnvironment = context.environment,
): boolean => {
  if (!('type' in target) || target.type !== 'object') {
    return false;
  }
  const keys = Object.keys(mapping);
  if (
    keys.some((key) => !Object.hasOwn(target.properties, key)) ||
    target.required.some((key) => !Object.hasOwn(mapping, key))
  ) {
    return false;
  }
  return keys.every((key) => {
    const selector = mapping[key];
    const expected = target.properties[key];
    if (selector === undefined || expected === undefined) {
      return false;
    }
    const selected = resolveSelector(selector, consumer, context, environment);
    return selected !== null && valueSchemaIsCompatible(selected, expected);
  });
};

const scalarMatches = (value: JsonScalar, schema: ValueSchema): boolean => {
  if ('anyOf' in schema) {
    return schema.anyOf.some((alternative) => scalarMatches(value, alternative));
  }
  if (value === null) {
    return schema.type === 'null';
  }
  if (typeof value === 'boolean') {
    return schema.type === 'boolean';
  }
  if (typeof value === 'string') {
    return schema.type === 'string' && (schema.enum === undefined || schema.enum.includes(value));
  }
  return (
    (schema.type === 'integer' || schema.type === 'number') &&
    (schema.minimum === undefined || value >= schema.minimum) &&
    (schema.maximum === undefined || value <= schema.maximum)
  );
};

const conditionMatches = (
  condition: ProgramRepeatCondition,
  consumer: ProgramNodeId,
  context: RegionContext,
  environment: SelectorEnvironment,
): boolean => {
  if (condition.kind === 'all' || condition.kind === 'any') {
    return condition.conditions.every((nested) =>
      conditionMatches(nested, consumer, context, environment),
    );
  }
  if (condition.kind === 'not') {
    return conditionMatches(condition.condition, consumer, context, environment);
  }
  const schema = resolveSelector(condition.selector, consumer, context, environment);
  if (schema === null || condition.kind === 'exists') {
    return schema !== null;
  }
  const values = condition.kind === 'equals' ? [condition.value] : condition.values;
  return values.every((value) => scalarMatches(value, schema));
};

const choiceMatches = (
  node: Extract<ProgramNode, { readonly kind: 'choice' }>,
  context: RegionContext,
): boolean => {
  const schema = resolveSelector(node.selector, node.id, context);
  if (schema === null) {
    return false;
  }
  const domains = node.cases.map(({ when }) => when);
  const values = domains.flatMap((domain) =>
    domain.kind === 'equals' ? [domain.value] : [...domain.values],
  );
  const unique = new Set(values.map((value) => canonicalizeOwnedValue(value).text));
  return (
    unique.size === values.length &&
    values.every((value) => scalarMatches(value, schema)) &&
    (node.otherwise !== null || casesCoverFiniteDomain(schema, domains))
  );
};

const isStringSchema = (schema: ValueSchema): boolean =>
  'anyOf' in schema ? schema.anyOf.every(isStringSchema) : schema.type === 'string';

const validateNode = (
  node: ProgramNode,
  region: ProgramRegion,
  context: RegionContext,
): boolean => {
  switch (node.kind) {
    case 'activity':
      return mappingMatches(node.input, node.inputSchema, node.id, context);
    case 'choice':
      return choiceMatches(node, context);
    case 'call': {
      const target = context.modules.get(node.module);
      return (
        target !== undefined && mappingMatches(node.input, target.inputSchema, node.id, context)
      );
    }
    case 'parallel':
      return node.branches.every(
        (branch) =>
          mappingMatches(branch.input, branch.region.inputSchema, node.id, context) &&
          context.validateChild(branch.region, {
            ...context.environment,
            scopeInput: branch.region.inputSchema,
          }),
      );
    case 'repeat': {
      const repeat = {
        iteration: Object.freeze({
          type: 'integer',
          minimum: 0,
          maximum: node.maximumIterations - 1,
        }) satisfies ValueSchema,
        previousOutput: node.body.outputSchema,
      };
      const afterBody = { ...context.environment, repeat, regionOutput: node.body.outputSchema };
      return (
        mappingMatches(node.initialInput, node.body.inputSchema, node.id, context) &&
        mappingMatches(node.nextInput, node.body.inputSchema, node.id, context, afterBody) &&
        conditionMatches(node.continueWhen, node.id, context, afterBody) &&
        mappingMatches(node.output, node.outputSchema, node.id, context, afterBody) &&
        context.validateChild(node.body, {
          ...context.environment,
          scopeInput: node.body.inputSchema,
          repeat,
        })
      );
    }
    case 'map': {
      const items = resolveMapItems(node, context);
      if (items === null) {
        return false;
      }
      const itemKey = projectValueSchema(items.item, node.itemKeyPointer);
      if (itemKey === null || !isStringSchema(itemKey)) {
        return false;
      }
      const mapEnvironment = { ...context.environment, map: { item: items.item, itemKey } };
      return (
        mappingMatches(node.bodyInput, node.body.inputSchema, node.id, context, mapEnvironment) &&
        context.validateChild(node.body, {
          ...context.environment,
          scopeInput: node.body.inputSchema,
          map: mapEnvironment.map,
        })
      );
    }
    case 'end': {
      const exit = region.exits.find(({ outcome }) => outcome === node.outcome);
      return exit !== undefined && mappingMatches(node.output, exit.outputSchema, node.id, context);
    }
    case 'wait':
    case 'humanGate':
      return true;
  }
  node satisfies never;
  return false;
};

export const hasValidProgramDataflow = (modules: ReadonlyMap<string, ProgramModule>): boolean => {
  const validateRegion = (region: ProgramRegion, environment: SelectorEnvironment): boolean => {
    const context: RegionContext = {
      environment,
      facts: regionFacts(region),
      modules,
      state: { nodeOutputs: new Map(), mapItems: new Map(), resolvingMaps: new Set() },
      validateChild: validateRegion,
    };
    return region.nodes.every((node) => validateNode(node, region, context));
  };
  return [...modules.values()].every((module) =>
    validateRegion(module.region, {
      moduleInput: module.inputSchema,
      scopeInput: module.region.inputSchema,
    }),
  );
};
