import { describe, expect, it } from 'vitest';

import { createDiagnosticCollector } from '../../../src/foundation/index.js';
import {
  PipelineFailureValueSchema,
  type ChoiceDomain,
  type ValueSchema,
  casesCoverFiniteDomain,
  finiteDomainOf,
  isPipelineFailureSchema,
  normalizeChoiceDomain,
  normalizeValueSchema,
  projectValueSchema,
  valueSchemasEqual,
} from '../../../src/source/index.js';

const normalize = (schema: ValueSchema) => {
  const collector = createDiagnosticCollector();
  const value = normalizeValueSchema(schema, '/schema', collector);
  return {
    value,
    diagnostics: collector.finalize().map(({ code, path }) => ({ code, path })),
  };
};

describe('ValueSchema semantics', () => {
  it.each([
    [{ type: 'null' }, { type: 'null' }],
    [{ type: 'boolean' }, { type: 'boolean' }],
    [
      { type: 'integer', minimum: 0, maximum: 2 },
      { type: 'integer', minimum: 0, maximum: 2 },
    ],
    [{ type: 'number' }, { type: 'number' }],
    [
      { type: 'string', enum: ['z', 'a'], minLength: 0, maxLength: 2 },
      { type: 'string', enum: ['a', 'z'], minLength: 0, maxLength: 2 },
    ],
    [
      { type: 'array', items: { type: 'boolean' }, minItems: 0, maxItems: 2 },
      { type: 'array', items: { type: 'boolean' }, minItems: 0, maxItems: 2 },
    ],
    [
      {
        type: 'object',
        properties: { value: { type: 'null' } },
        required: ['value'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { value: { type: 'null' } },
        required: ['value'],
        additionalProperties: false,
      },
    ],
  ] as const)('normalizes the complete closed algebra %#', (schema, expected) => {
    expect(normalize(schema).value).toEqual(expected);
  });

  it.each([
    [{ type: 'integer', minimum: 2, maximum: 1 }, '/schema'],
    [{ type: 'string', minLength: -1 }, '/schema'],
    [{ type: 'array', items: { type: 'null' }, minItems: 2, maxItems: 1 }, '/schema'],
    [
      { type: 'object', properties: {}, required: ['missing'], additionalProperties: false },
      '/schema/required',
    ],
    [{ type: 'string', enum: ['same', 'same'] }, '/schema/enum'],
    [{ anyOf: [{ type: 'null' }, { type: 'null' }] }, '/schema/anyOf'],
  ] as const)('reports invalid schema relationship %#', (schema, path) => {
    expect(normalize(schema as ValueSchema).diagnostics).toContainEqual({
      code:
        path.includes('required') || path.includes('enum') || path.includes('anyOf')
          ? 'CANONICAL_INPUT'
          : 'BOUND_EXCEEDED',
      path,
    });
  });

  it('preserves ordered, distinct anyOf alternatives and absent-versus-empty enum', () => {
    expect(normalize({ anyOf: [{ type: 'string' }, { type: 'string', enum: [] }] }).value).toEqual({
      anyOf: [{ type: 'string' }, { type: 'string', enum: [] }],
    });
  });

  it('preserves an own __proto__ schema property on an ordinary frozen record', () => {
    const properties: Record<string, ValueSchema> = Object.fromEntries([
      ['__proto__', { type: 'boolean' }],
    ]);
    const result = normalize({
      type: 'object',
      properties,
      required: ['__proto__'],
      additionalProperties: false,
    }).value;
    if ('anyOf' in result || result.type !== 'object') {
      throw new TypeError('Expected an object schema.');
    }
    expect(Object.getPrototypeOf(result.properties)).toBe(Object.prototype);
    expect(Object.hasOwn(result.properties, '__proto__')).toBe(true);
    expect(result.properties.__proto__).toEqual({ type: 'boolean' });
    expect(Object.isFrozen(result.properties)).toBe(true);
  });

  it('normalizes ChoiceDomain as a type-sensitive canonical scalar set', () => {
    const collector = createDiagnosticCollector();
    const domain = normalizeChoiceDomain(
      { kind: 'oneOf', values: ['1', 1, false, null] },
      '/domain',
      collector,
    );

    expect(domain).toEqual({ kind: 'oneOf', values: ['1', 1, false, null] });
    expect(normalizeChoiceDomain({ kind: 'equals', value: true }, '/equals', collector)).toEqual({
      kind: 'equals',
      value: true,
    });
    normalizeChoiceDomain({ kind: 'oneOf', values: [1, 1] }, '/duplicate', collector);
    expect(collector.finalize()).toContainEqual(
      expect.objectContaining({
        code: 'CANONICAL_INPUT',
        path: '/duplicate/values',
      }),
    );
  });

  it('projects closed object, array, and anyOf schemas without runtime values', () => {
    const object: ValueSchema = {
      type: 'object',
      properties: {
        list: {
          type: 'array',
          items: { type: 'string', enum: ['x'] },
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ['list'],
      additionalProperties: false,
    };
    const union: ValueSchema = { anyOf: [object, object] };

    expect(projectValueSchema(object, '/list/0')).toEqual({ type: 'string', enum: ['x'] });
    expect(projectValueSchema(object, '/list/2')).toBeNull();
    expect(projectValueSchema(object, '/list/01')).toBeNull();
    expect(projectValueSchema(object, '/missing')).toBeNull();
    expect(projectValueSchema({ type: 'boolean' }, '/value')).toBeNull();
    expect(projectValueSchema(union, '/list/0')).toEqual({ type: 'string', enum: ['x'] });
    expect(projectValueSchema({ anyOf: [object, { type: 'null' }] }, '/list')).toBeNull();
  });

  it('projects decoded escaped tokens through every anyOf branch', () => {
    const alternative = (value: string): ValueSchema => ({
      type: 'object',
      properties: {
        'a/b': {
          type: 'object',
          properties: { '~key': { type: 'string', enum: [value] } },
          required: ['~key'],
          additionalProperties: false,
        },
      },
      required: ['a/b'],
      additionalProperties: false,
    });

    expect(
      projectValueSchema({ anyOf: [alternative('left'), alternative('right')] }, '/a~1b/~0key'),
    ).toEqual({
      anyOf: [
        { type: 'string', enum: ['left'] },
        { type: 'string', enum: ['right'] },
      ],
    });
  });

  it('projects only structurally guaranteed object properties and array indexes', () => {
    const optionalObject: ValueSchema = {
      type: 'object',
      properties: { value: { type: 'boolean' } },
      required: [],
      additionalProperties: false,
    };
    const optionalArray: ValueSchema = {
      type: 'array',
      items: { type: 'boolean' },
      maxItems: 2,
    };
    const guaranteedArray: ValueSchema = {
      type: 'array',
      items: { type: 'boolean' },
      minItems: 2,
      maxItems: 4,
    };

    expect(projectValueSchema(optionalObject, '/value')).toBeNull();
    expect(projectValueSchema(optionalArray, '/0')).toBeNull();
    expect(projectValueSchema(guaranteedArray, '/1')).toEqual({ type: 'boolean' });
    expect(projectValueSchema(guaranteedArray, '/2')).toBeNull();
  });

  it('sorts ValueSchema string sets by Unicode code point rather than JSON bytes', () => {
    const values = ['a', '\\', '"', '\n'];
    const stringSchema = normalize({ type: 'string', enum: values }).value;
    const objectSchema = normalize({
      type: 'object',
      properties: Object.fromEntries(values.map((key) => [key, { type: 'null' }])),
      required: values,
      additionalProperties: false,
    }).value;

    expect(stringSchema).toMatchObject({ enum: ['\n', '"', '\\', 'a'] });
    expect(objectSchema).toMatchObject({ required: ['\n', '"', '\\', 'a'] });
  });

  it.each([
    [{ type: 'null' }, true],
    [{ type: 'boolean' }, true],
    [{ type: 'string', enum: [] }, true],
    [{ type: 'string' }, false],
    [{ type: 'integer', minimum: 0, maximum: 1 }, true],
    [{ type: 'number' }, false],
    [{ type: 'array', items: { type: 'null' } }, false],
    [{ type: 'object', properties: {}, required: [], additionalProperties: false }, false],
  ] as const)('detects finite domains %#', (schema, finite) => {
    expect(finiteDomainOf(schema as ValueSchema) !== null).toBe(finite);
  });

  it('merges finite anyOf intervals and proves exact scalar/range coverage', () => {
    const schema: ValueSchema = {
      anyOf: [
        { type: 'null' },
        { type: 'boolean' },
        { type: 'integer', minimum: 0, maximum: 1 },
        { type: 'integer', minimum: 2, maximum: 3 },
      ],
    };
    const cases: ChoiceDomain[] = [
      { kind: 'oneOf', values: [null, false, true] },
      { kind: 'oneOf', values: [0, 1, 2, 3] },
    ];

    expect(casesCoverFiniteDomain(schema, cases)).toBe(true);
    expect(casesCoverFiniteDomain(schema, cases.slice(0, 1))).toBe(false);
    expect(casesCoverFiniteDomain({ type: 'string' }, cases)).toBe(false);
    expect(
      casesCoverFiniteDomain({ type: 'integer', minimum: 0, maximum: 1 }, [
        { kind: 'oneOf', values: [0, 2] },
      ]),
    ).toBe(false);
  });

  it('compares canonical schemas and recognizes only the exact failure schema', () => {
    expect(valueSchemasEqual({ type: 'null' }, { type: 'null' })).toBe(true);
    expect(valueSchemasEqual({ type: 'null' }, { type: 'boolean' })).toBe(false);
    expect(isPipelineFailureSchema(PipelineFailureValueSchema)).toBe(true);
    expect(isPipelineFailureSchema({ anyOf: [PipelineFailureValueSchema, { type: 'null' }] })).toBe(
      false,
    );
  });
});
