import { isCanonicalJsonArrayIndex, parseJsonPointer, type JsonPointer } from '../json-pointer.js';
import type { ValueSchema } from './contracts.js';
import { valueSchemaText } from './normalization.js';

type AnyOfValueSchema = Extract<ValueSchema, { readonly anyOf: readonly ValueSchema[] }>;
type ObjectValueSchema = Extract<ValueSchema, { readonly type: 'object' }>;
type ArrayValueSchema = Extract<ValueSchema, { readonly type: 'array' }>;

const combineAlternatives = (alternatives: readonly (ValueSchema | null)[]): ValueSchema | null => {
  if (alternatives.includes(null)) {
    return null;
  }
  const unique = new Map<string, ValueSchema>();
  for (const alternative of alternatives) {
    if (alternative !== null) {
      unique.set(valueSchemaText(alternative), alternative);
    }
  }
  const projected = [...unique.values()];
  if (projected.length === 1) {
    return projected[0] ?? null;
  }
  const [first, second, ...rest] = projected;
  if (first === undefined || second === undefined) {
    return null;
  }
  const anyOf: [ValueSchema, ValueSchema, ...ValueSchema[]] = [first, second, ...rest];
  return Object.freeze({ anyOf: Object.freeze(anyOf) });
};

const projectAlternatives = (
  schema: AnyOfValueSchema,
  tokens: readonly string[],
  tokenIndex: number,
): ValueSchema | null =>
  combineAlternatives(
    schema.anyOf.map((alternative) => projectTokens(alternative, tokens, tokenIndex)),
  );

const projectObject = (
  schema: ObjectValueSchema,
  token: string,
  tokens: readonly string[],
  tokenIndex: number,
): ValueSchema | null => {
  const property = schema.properties[token];
  return property === undefined || !schema.required.includes(token)
    ? null
    : projectTokens(property, tokens, tokenIndex + 1);
};

const projectArray = (
  schema: ArrayValueSchema,
  token: string,
  tokens: readonly string[],
  tokenIndex: number,
): ValueSchema | null => {
  if (!isCanonicalJsonArrayIndex(token)) {
    return null;
  }
  const index = Number(token);
  return !Number.isSafeInteger(index) || schema.minItems === undefined || index >= schema.minItems
    ? null
    : projectTokens(schema.items, tokens, tokenIndex + 1);
};

function projectTokens(
  schema: ValueSchema,
  tokens: readonly string[],
  tokenIndex: number,
): ValueSchema | null {
  if (tokenIndex >= tokens.length) {
    return schema;
  }
  const token = tokens[tokenIndex];
  if (token === undefined) {
    return null;
  }
  if ('anyOf' in schema) {
    return projectAlternatives(schema, tokens, tokenIndex);
  }
  if (schema.type === 'object') {
    return projectObject(schema, token, tokens, tokenIndex);
  }
  if (schema.type === 'array') {
    return projectArray(schema, token, tokens, tokenIndex);
  }
  return null;
}

export const projectValueSchema = (
  schema: ValueSchema,
  pointer: JsonPointer,
): ValueSchema | null => {
  const tokens = parseJsonPointer(pointer);
  return tokens === null ? null : projectTokens(schema, tokens, 0);
};
