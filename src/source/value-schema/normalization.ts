import {
  PIPELINE_LIMITS,
  appendJsonPointer,
  canonicalizeOwnedValue,
  compareUnicodeCodePoints,
  type DiagnosticCollector,
  type JsonPointer,
  type JsonScalar,
} from '../../foundation/index.js';
import {
  PipelineFailureValueSchema,
  type ChoiceDomain,
  type ValueSchema,
} from '../contracts/index.js';
import { atLeastTwoTuple, nonEmptyTuple } from '../internal.js';

type StringValueSchema = Extract<ValueSchema, { readonly type: 'string' }>;
type ArrayValueSchema = Extract<ValueSchema, { readonly type: 'array' }>;
type ObjectValueSchema = Extract<ValueSchema, { readonly type: 'object' }>;

const scalarKey = (value: JsonScalar): string => {
  if (value === null) {
    return 'null';
  }
  return `${typeof value}:${canonicalizeOwnedValue(value).text}`;
};

const compareBytes = (left: Uint8Array, right: Uint8Array): number => {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.byteLength - right.byteLength;
};

export const compareCanonicalScalars = (left: JsonScalar, right: JsonScalar): number =>
  compareBytes(canonicalizeOwnedValue(left).bytes, canonicalizeOwnedValue(right).bytes);

const normalizeScalarSet = (
  values: readonly JsonScalar[],
  path: JsonPointer,
  collector: DiagnosticCollector,
): readonly JsonScalar[] => {
  const seen = new Set<string>();
  for (const value of values) {
    const key = scalarKey(value);
    if (seen.has(key)) {
      collector.add('CANONICAL_INPUT', path);
    }
    seen.add(key);
  }
  return Object.freeze([...values].sort(compareCanonicalScalars));
};

const normalizeStringSet = (
  values: readonly string[],
  path: JsonPointer,
  collector: DiagnosticCollector,
): readonly string[] => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      collector.add('CANONICAL_INPUT', path);
    }
    seen.add(value);
  }
  return Object.freeze([...values].sort(compareUnicodeCodePoints));
};

const normalizeBounds = (
  minimum: number | undefined,
  maximum: number | undefined,
  path: JsonPointer,
  collector: DiagnosticCollector,
): void => {
  if ((minimum !== undefined && minimum < 0) || (maximum !== undefined && maximum < 0)) {
    collector.add('BOUND_EXCEEDED', path);
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    collector.add('BOUND_EXCEEDED', path);
  }
};

export const valueSchemaText = (schema: ValueSchema): string => canonicalizeOwnedValue(schema).text;

export const valueSchemasEqual = (left: ValueSchema, right: ValueSchema): boolean =>
  valueSchemaText(left) === valueSchemaText(right);

export const isPipelineFailureSchema = (schema: ValueSchema): boolean =>
  valueSchemasEqual(schema, PipelineFailureValueSchema);

const normalizeStringSchema = (
  schema: StringValueSchema,
  path: JsonPointer,
  collector: DiagnosticCollector,
): ValueSchema => {
  normalizeBounds(schema.minLength, schema.maxLength, path, collector);
  const enumeration =
    schema.enum === undefined
      ? undefined
      : normalizeStringSet(schema.enum, appendJsonPointer(path, 'enum'), collector);
  return Object.freeze({
    type: 'string',
    ...(enumeration === undefined ? {} : { enum: enumeration }),
    ...(schema.minLength === undefined ? {} : { minLength: schema.minLength }),
    ...(schema.maxLength === undefined ? {} : { maxLength: schema.maxLength }),
  });
};

const normalizeArraySchema = (
  schema: ArrayValueSchema,
  path: JsonPointer,
  collector: DiagnosticCollector,
  depth: number,
): ValueSchema => {
  normalizeBounds(schema.minItems, schema.maxItems, path, collector);
  return Object.freeze({
    type: 'array',
    items: normalizeValueSchema(
      schema.items,
      appendJsonPointer(path, 'items'),
      collector,
      depth + 1,
    ),
    ...(schema.minItems === undefined ? {} : { minItems: schema.minItems }),
    ...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }),
  });
};

const normalizeObjectSchema = (
  schema: ObjectValueSchema,
  path: JsonPointer,
  collector: DiagnosticCollector,
  depth: number,
): ValueSchema => {
  const properties: Record<string, ValueSchema> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    properties[key] = normalizeValueSchema(
      value,
      appendJsonPointer(appendJsonPointer(path, 'properties'), key),
      collector,
      depth + 1,
    );
  }
  const requiredPath = appendJsonPointer(path, 'required');
  const required = normalizeStringSet(schema.required, requiredPath, collector);
  if (required.some((key) => !Object.hasOwn(properties, key))) {
    collector.add('CANONICAL_INPUT', requiredPath);
  }
  return Object.freeze({
    type: 'object',
    properties: Object.freeze(properties),
    required,
    additionalProperties: false,
  });
};

export const normalizeValueSchema = (
  schema: ValueSchema,
  path: JsonPointer,
  collector: DiagnosticCollector,
  depth = 0,
): ValueSchema => {
  if (depth > PIPELINE_LIMITS.portableValue.depth) {
    collector.add('BOUND_EXCEEDED', path);
  }
  if ('anyOf' in schema) {
    const anyOfPath = appendJsonPointer(path, 'anyOf');
    const anyOf = schema.anyOf.map((alternative, index) =>
      normalizeValueSchema(
        alternative,
        appendJsonPointer(anyOfPath, String(index)),
        collector,
        depth + 1,
      ),
    );
    const identities = new Set<string>();
    for (const alternative of anyOf) {
      const identity = valueSchemaText(alternative);
      if (identities.has(identity)) {
        collector.add('CANONICAL_INPUT', anyOfPath);
      }
      identities.add(identity);
    }
    return Object.freeze({ anyOf: atLeastTwoTuple(anyOf) });
  }

  switch (schema.type) {
    case 'null':
    case 'boolean':
      return Object.freeze({ type: schema.type });
    case 'integer':
    case 'number': {
      if (
        schema.minimum !== undefined &&
        schema.maximum !== undefined &&
        schema.minimum > schema.maximum
      ) {
        collector.add('BOUND_EXCEEDED', path);
      }
      return Object.freeze({
        type: schema.type,
        ...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
        ...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
      });
    }
    case 'string':
      return normalizeStringSchema(schema, path, collector);
    case 'array':
      return normalizeArraySchema(schema, path, collector, depth);
    case 'object':
      return normalizeObjectSchema(schema, path, collector, depth);
  }
  throw new TypeError('Unexpected schema-validated ValueSchema.');
};

export const normalizeChoiceDomain = (
  domain: ChoiceDomain,
  path: JsonPointer,
  collector: DiagnosticCollector,
): ChoiceDomain =>
  domain.kind === 'equals'
    ? Object.freeze({ kind: 'equals', value: domain.value })
    : Object.freeze({
        kind: 'oneOf',
        values: nonEmptyTuple(
          normalizeScalarSet(domain.values, appendJsonPointer(path, 'values'), collector),
        ),
      });

export { scalarKey };
