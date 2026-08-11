import { parseJsonPointer, type JsonPointer } from '../../foundation/index.js';
import type { ValueSchema } from '../contracts/index.js';
import { atLeastTwoTuple } from '../internal.js';
import { valueSchemaText } from './normalization.js';

const canonicalArrayIndex = /^(?:0|[1-9]\d*)$/u;

const projectTokens = (
  schema: ValueSchema,
  tokens: readonly string[],
  tokenIndex: number,
): ValueSchema | null => {
  if (tokenIndex >= tokens.length) {
    return schema;
  }
  const token = tokens[tokenIndex];
  if (token === undefined) {
    return null;
  }
  if ('anyOf' in schema) {
    const alternatives = schema.anyOf.map((alternative) =>
      projectTokens(alternative, tokens, tokenIndex),
    );
    if (alternatives.some((alternative) => alternative === null)) {
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
      ? (projected[0] ?? schema)
      : { anyOf: atLeastTwoTuple(projected) };
  }
  if (schema.type === 'object') {
    const property = schema.properties[token];
    if (property === undefined || !schema.required.includes(token)) {
      return null;
    }
    return projectTokens(property, tokens, tokenIndex + 1);
  }
  if (schema.type === 'array') {
    if (!canonicalArrayIndex.test(token)) {
      return null;
    }
    const index = Number(token);
    if (!Number.isSafeInteger(index) || schema.minItems === undefined || index >= schema.minItems) {
      return null;
    }
    return projectTokens(schema.items, tokens, tokenIndex + 1);
  }
  return null;
};

export const projectValueSchema = (
  schema: ValueSchema,
  pointer: JsonPointer,
): ValueSchema | null => {
  const tokens = parseJsonPointer(pointer);
  return tokens === null ? null : projectTokens(schema, tokens, 0);
};
