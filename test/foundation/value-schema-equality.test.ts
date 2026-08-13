import { Equal } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import {
  canonicalizeOwnedValue,
  valueSchemasEqual,
  type ValueSchema,
} from '../../src/foundation/index.js';

const canonicalSchemasEqual = (left: ValueSchema, right: ValueSchema): boolean =>
  canonicalizeOwnedValue(left).text === canonicalizeOwnedValue(right).text;

const boundedPairs = (
  minima: readonly (number | undefined)[],
  maxima: readonly (number | undefined)[],
): readonly (readonly [number | undefined, number | undefined])[] =>
  minima.flatMap((minimum) =>
    maxima
      .filter((maximum) => minimum === undefined || maximum === undefined || minimum <= maximum)
      .map((maximum) => [minimum, maximum] as const),
  );

const numericSchemas = (): readonly ValueSchema[] =>
  (['integer', 'number'] as const).flatMap((type) =>
    boundedPairs([undefined, -1, -0, 1], [undefined, 0, 2]).map(([minimum, maximum]) => ({
      type,
      ...(minimum === undefined ? {} : { minimum }),
      ...(maximum === undefined ? {} : { maximum }),
    })),
  );

const stringSchemas = (): readonly ValueSchema[] =>
  [undefined, [], ['a'], ['é', '😀']].flatMap((enumeration) =>
    boundedPairs([undefined, 0, 1], [undefined, 1, 64]).map(([minLength, maxLength]) => ({
      type: 'string' as const,
      ...(enumeration === undefined ? {} : { enum: enumeration }),
      ...(minLength === undefined ? {} : { minLength }),
      ...(maxLength === undefined ? {} : { maxLength }),
    })),
  );

const schemaPopulation = (): readonly ValueSchema[] => {
  const scalars: readonly ValueSchema[] = [
    { type: 'null' },
    { type: 'boolean' },
    ...numericSchemas(),
    ...stringSchemas(),
  ];
  const arrayItems = [scalars[0]!, scalars[1]!, scalars.at(-1)!];
  const arrays = arrayItems.flatMap((items) =>
    boundedPairs([undefined, 0, 1], [undefined, 1, 8]).map(([minItems, maxItems]) => ({
      type: 'array' as const,
      items,
      ...(minItems === undefined ? {} : { minItems }),
      ...(maxItems === undefined ? {} : { maxItems }),
    })),
  );
  const objectLeft: ValueSchema = {
    type: 'object',
    properties: { alpha: { type: 'boolean' }, omega: arrays[0]! },
    required: ['alpha', 'omega'],
    additionalProperties: false,
  };
  const objectRight: ValueSchema = {
    additionalProperties: false,
    required: ['alpha', 'omega'],
    properties: { omega: arrays[0]!, alpha: { type: 'boolean' } },
    type: 'object',
  };
  const nullable: ValueSchema = { anyOf: [{ type: 'null' }, objectLeft] };
  const nestedUnion: ValueSchema = {
    anyOf: [nullable, { type: 'array', items: { anyOf: [{ type: 'boolean' }, { type: 'null' }] } }],
  };
  return [...scalars, ...arrays, objectLeft, objectRight, nullable, nestedUnion];
};

describe('ValueSchema equality equivalence', () => {
  it('matches canonical equality for the exhaustive generated variant matrix', () => {
    const schemas = schemaPopulation();

    for (const left of schemas) {
      for (const right of schemas) {
        expect(Equal(left, right)).toBe(canonicalSchemasEqual(left, right));
      }
    }
  });

  it('preserves property-order, union-order, array, bound, and negative-zero semantics', () => {
    const objectLeft: ValueSchema = {
      type: 'object',
      properties: { first: { type: 'null' }, second: { type: 'boolean' } },
      required: ['first', 'second'],
      additionalProperties: false,
    };
    const objectReordered: ValueSchema = {
      additionalProperties: false,
      required: ['first', 'second'],
      properties: { second: { type: 'boolean' }, first: { type: 'null' } },
      type: 'object',
    };
    const nullable: ValueSchema = { anyOf: [{ type: 'null' }, objectLeft] };
    const nullableReversed: ValueSchema = { anyOf: [objectLeft, { type: 'null' }] };
    const vectors = [
      [objectLeft, objectReordered, true],
      [nullable, nullableReversed, false],
      [
        { type: 'array', items: nullable, minItems: 0, maxItems: 2 },
        { maxItems: 2, minItems: 0, items: nullable, type: 'array' },
        true,
      ],
      [{ type: 'integer', minimum: -0 }, { type: 'integer', minimum: 0 }, true],
      [{ type: 'integer', maximum: 1 }, { type: 'integer', maximum: 2 }, false],
      [{ type: 'string', enum: ['a', 'é'] }, { type: 'string', enum: ['é', 'a'] }, false],
    ] as const satisfies readonly (readonly [ValueSchema, ValueSchema, boolean])[];

    for (const [left, right, expected] of vectors) {
      expect(canonicalSchemasEqual(left, right)).toBe(expected);
      expect(Equal(left, right)).toBe(expected);
      expect(valueSchemasEqual(left, right)).toBe(expected);
    }
  });
});
