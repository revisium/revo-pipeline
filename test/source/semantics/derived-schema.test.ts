import { describe, expect, it } from 'vitest';

import {
  literalValueSchema,
  sourceNodeOutputSchema,
  type ValueSchema,
} from '../../../src/source/index.js';
import { sourceNodeBuilders } from '../../support/source-builders.js';

const objectProperties = (
  schema: ValueSchema,
  nested?: string,
): Readonly<Record<string, ValueSchema>> => {
  if ('anyOf' in schema || schema.type !== 'object') {
    throw new TypeError('Expected an object schema.');
  }
  if (nested === undefined) {
    return schema.properties;
  }
  const child = schema.properties[nested];
  if (child === undefined || 'anyOf' in child || child.type !== 'object') {
    throw new TypeError('Expected a nested object schema.');
  }
  return child.properties;
};

const expectOwnProto = (properties: Readonly<Record<string, ValueSchema>>): void => {
  expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
  expect(Object.hasOwn(properties, '__proto__')).toBe(true);
  expect(Object.isFrozen(properties)).toBe(true);
};

describe('source-derived schemas', () => {
  it('preserves an own __proto__ property in literal schemas', () => {
    const schema = literalValueSchema(Object.fromEntries([['__proto__', true]]));
    const properties = objectProperties(schema);
    expect(Object.hasOwn(properties, '__proto__')).toBe(true);
    expectOwnProto(properties);
  });

  it('preserves an own __proto__ parallel branch in its output schema', () => {
    const base = sourceNodeBuilders.parallel();
    const schema = sourceNodeOutputSchema({
      ...base,
      branches: [{ ...base.branches[0], key: '__proto__' }, base.branches[1]],
    });
    if (schema === null) {
      throw new TypeError('Expected a derived output schema.');
    }
    const properties = objectProperties(schema, 'branches');
    expect(Object.hasOwn(properties, '__proto__')).toBe(true);
    expectOwnProto(properties);
  });

  it('preserves an own __proto__ consensus participant in its output schema', () => {
    const base = sourceNodeBuilders.consensus();
    const schema = sourceNodeOutputSchema({
      ...base,
      participants: [{ ...base.participants[0], key: '__proto__' }, base.participants[1]],
    });
    if (schema === null) {
      throw new TypeError('Expected a derived output schema.');
    }
    const properties = objectProperties(schema, 'votes');
    expect(Object.hasOwn(properties, '__proto__')).toBe(true);
    expectOwnProto(properties);
  });
});
