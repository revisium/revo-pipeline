import { parseJsonPointer, type JsonPointer } from '../../foundation/index.js';
import type { ValueSchema } from '../contracts/index.js';
import { atLeastTwoTuple } from '../internal.js';
import { valueSchemaText } from './normalization.js';

const canonicalArrayIndex = /^(?:0|[1-9]\d*)$/u;

type AnyOfValueSchema = Extract<ValueSchema, { readonly anyOf: readonly ValueSchema[] }>;
type ObjectValueSchema = Extract<ValueSchema, { readonly type: 'object' }>;
type ArrayValueSchema = Extract<ValueSchema, { readonly type: 'array' }>;

const combineProjectedAlternatives = (
  alternatives: readonly (ValueSchema | null)[],
  fallback: ValueSchema,
): ValueSchema | null => {
  if (alternatives.includes(null)) {
    return null;
  }
  const unique = new Map<string, ValueSchema>();
  for (const alternative of alternatives) {
    if (alternative !== null) {
      const identity = valueSchemaText(alternative);
      if (!unique.has(identity)) {
        unique.set(identity, alternative);
      }
    }
  }
  const projected = [...unique.values()];
  return projected.length === 1
    ? (projected[0] ?? fallback)
    : { anyOf: atLeastTwoTuple(projected) };
};

const projectAlternatives = (
  schema: AnyOfValueSchema,
  tokens: readonly string[],
  tokenIndex: number,
): ValueSchema | null =>
  combineProjectedAlternatives(
    schema.anyOf.map((alternative) => projectTokens(alternative, tokens, tokenIndex)),
    schema,
  );

const projectObjectToken = (
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

const projectArrayToken = (
  schema: ArrayValueSchema,
  token: string,
  tokens: readonly string[],
  tokenIndex: number,
): ValueSchema | null => {
  if (!canonicalArrayIndex.test(token)) {
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
    return projectObjectToken(schema, token, tokens, tokenIndex);
  }
  if (schema.type === 'array') {
    return projectArrayToken(schema, token, tokens, tokenIndex);
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
