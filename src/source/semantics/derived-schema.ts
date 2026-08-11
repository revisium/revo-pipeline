import {
  canonicalizeOwnedValue,
  compareUnicodeCodePoints,
  type JsonValue,
} from '../../foundation/index.js';
import {
  PipelineFailureValueSchema,
  type HumanGateSourceNode,
  type MapSourceNode,
  type ParallelSourceBranch,
  type SourceNode,
  type ValueSchema,
} from '../contracts/index.js';

const stringEnum = (...values: readonly string[]): ValueSchema =>
  Object.freeze({
    type: 'string',
    enum: Object.freeze([...new Set(values)].sort(compareUnicodeCodePoints)),
  });

const closedValueObject = (properties: Readonly<Record<string, ValueSchema>>): ValueSchema => {
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

const schemaUnion = (schemas: readonly ValueSchema[]): ValueSchema | null => {
  const unique = new Map<string, ValueSchema>();
  for (const schema of schemas) {
    unique.set(canonicalizeOwnedValue(schema).text, schema);
  }
  const values = [...unique.values()];
  if (values.length === 0) {
    return null;
  }
  if (values.length === 1) {
    return values[0] ?? null;
  }
  const [first, second, ...rest] = values;
  if (first === undefined || second === undefined) {
    return null;
  }
  const anyOf: [ValueSchema, ValueSchema, ...ValueSchema[]] = [first, second, ...rest];
  return Object.freeze({ anyOf: Object.freeze(anyOf) });
};

const isJsonObject = (value: JsonValue): value is { readonly [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const literalValueSchema = (value: JsonValue): ValueSchema => {
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
    const items =
      schemaUnion(value.map(literalValueSchema)) ?? Object.freeze({ type: 'null' as const });
    return Object.freeze({ type: 'array', items, minItems: value.length, maxItems: value.length });
  }
  if (!isJsonObject(value)) {
    throw new TypeError('Unexpected normalized JSON value.');
  }
  const properties: Record<string, ValueSchema> = {};
  for (const [key, nested] of Object.entries(value)) {
    properties[key] = literalValueSchema(nested);
  }
  return closedValueObject(properties);
};

const parallelBranchSchema = (branch: ParallelSourceBranch): ValueSchema => {
  const completed = branch.exits
    .filter(
      ({ classification }) => classification === 'qualifies' || classification === 'doesNotQualify',
    )
    .map(({ outcome }) => {
      const outputSchema = branch.region.exits.find(
        (exit) => exit.outcome === outcome,
      )?.outputSchema;
      return outputSchema === undefined
        ? null
        : closedValueObject({
            status: stringEnum('completed'),
            outcome: stringEnum(outcome),
            output: outputSchema,
          });
    })
    .filter((schema): schema is ValueSchema => schema !== null);
  return (
    schemaUnion([
      ...completed,
      closedValueObject({ status: stringEnum('failed'), failure: PipelineFailureValueSchema }),
      closedValueObject({ status: stringEnum('cancelled') }),
    ]) ?? closedValueObject({ status: stringEnum('cancelled') })
  );
};

const parallelOutputSchema = (branches: readonly ParallelSourceBranch[]): ValueSchema => {
  const properties: Record<string, ValueSchema> = {};
  for (const branch of branches) {
    properties[branch.key] = parallelBranchSchema(branch);
  }
  return closedValueObject({
    classification: stringEnum('completed', 'impossible', 'failed', 'cancelled'),
    branches: closedValueObject(properties),
  });
};

const voteResultSchema = (): ValueSchema =>
  schemaUnion([
    closedValueObject({
      status: stringEnum('vote'),
      vote: stringEnum('approve', 'reject', 'abstain'),
    }),
    closedValueObject({ status: stringEnum('failed'), failure: PipelineFailureValueSchema }),
    closedValueObject({ status: stringEnum('cancelled') }),
  ]) ?? closedValueObject({ status: stringEnum('cancelled') });

const consensusOutputSchema = (
  node: Extract<SourceNode, { readonly kind: 'consensus' }>,
): ValueSchema => {
  const votes: Record<string, ValueSchema> = {};
  for (const participant of node.participants) {
    votes[participant.key] = voteResultSchema();
  }
  return closedValueObject({
    classification: stringEnum(
      'approved',
      'rejected',
      'inconclusive',
      'participantFailed',
      'cancelled',
    ),
    votes: closedValueObject(votes),
  });
};

const humanGateOutputSchema = (node: HumanGateSourceNode): ValueSchema =>
  schemaUnion([
    closedValueObject({
      kind: stringEnum('answer'),
      answer: stringEnum(...node.answers),
      actorRef: Object.freeze({ type: 'string' }),
    }),
    closedValueObject({ kind: stringEnum('conflict') }),
    closedValueObject({ kind: stringEnum('deadline') }),
  ]) ?? closedValueObject({ kind: stringEnum('deadline') });

export type MapItemsSchema = {
  readonly item: ValueSchema;
  readonly minimumItems: number;
  readonly maximumItems?: number;
};

const arrayAlternatives = (
  schema: ValueSchema,
): readonly Extract<ValueSchema, { readonly type: 'array' }>[] | null => {
  if ('anyOf' in schema) {
    const alternatives = schema.anyOf.map(arrayAlternatives);
    return alternatives.some((alternative) => alternative === null)
      ? null
      : alternatives.flatMap((alternative) => alternative ?? []);
  }
  return schema.type === 'array' ? [schema] : null;
};

export const mapItemsSchema = (schema: ValueSchema): MapItemsSchema | null => {
  const alternatives = arrayAlternatives(schema);
  if (alternatives === null || alternatives.length === 0) {
    return null;
  }
  const item = schemaUnion(alternatives.map((alternative) => alternative.items));
  if (item === null) {
    return null;
  }
  const maximumItems = alternatives.every((alternative) => alternative.maxItems !== undefined)
    ? Math.max(...alternatives.map((alternative) => alternative.maxItems ?? 0))
    : undefined;
  return Object.freeze({
    item,
    minimumItems: Math.min(...alternatives.map((alternative) => alternative.minItems ?? 0)),
    ...(maximumItems === undefined ? {} : { maximumItems }),
  });
};

const mapOutputSchema = (node: MapSourceNode, items: MapItemsSchema): ValueSchema => {
  const completedOutputs = node.bodyExits
    .filter(({ classification }) => classification === 'completed')
    .map(({ outcome }) => node.body.exits.find((exit) => exit.outcome === outcome)?.outputSchema)
    .filter((schema): schema is ValueSchema => schema !== undefined);
  const completedOutput = schemaUnion(completedOutputs);
  const variants: ValueSchema[] = [
    closedValueObject({
      itemKey: Object.freeze({ type: 'string' }),
      status: stringEnum('failed'),
      output: Object.freeze({ type: 'null' }),
      errorCode: Object.freeze({ type: 'string' }),
    }),
    closedValueObject({
      itemKey: Object.freeze({ type: 'string' }),
      status: stringEnum('cancelled'),
      output: Object.freeze({ type: 'null' }),
      errorCode: Object.freeze({ type: 'null' }),
    }),
  ];
  if (completedOutput !== null) {
    variants.unshift(
      closedValueObject({
        itemKey: Object.freeze({ type: 'string' }),
        status: stringEnum('succeeded'),
        output: completedOutput,
        errorCode: Object.freeze({ type: 'null' }),
      }),
    );
  }
  const maximumItems = Math.min(items.maximumItems ?? node.maximumItems, node.maximumItems);
  return closedValueObject({
    items: Object.freeze({
      type: 'array',
      items: schemaUnion(variants) ?? variants[0] ?? Object.freeze({ type: 'null' }),
      minItems: items.minimumItems,
      maxItems: maximumItems,
    }),
  });
};

export const sourceNodeOutputSchema = (
  node: SourceNode,
  mapItems?: MapItemsSchema,
): ValueSchema | null => {
  switch (node.kind) {
    case 'agent':
      return node.strategies.every(({ kind }) => kind === 'single') ? node.outputSchema : null;
    case 'script':
    case 'effect':
    case 'repeat':
    case 'call':
      return node.outputSchema;
    case 'wait':
      return node.wait.kind === 'signal' && node.wait.payloadSchema !== null
        ? node.wait.payloadSchema
        : Object.freeze({ type: 'null' });
    case 'parallel':
      return parallelOutputSchema(node.branches);
    case 'consensus':
      return consensusOutputSchema(node);
    case 'humanGate':
      return humanGateOutputSchema(node);
    case 'map':
      return mapItems === undefined ? null : mapOutputSchema(node, mapItems);
    case 'choice':
    case 'end':
      return null;
  }
  throw new TypeError('Unexpected schema-validated source node.');
};
