import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type {
  PipelineSourcePackage,
  ScriptSourceNode,
  ValueSchema,
  ValueSelector,
} from '../../../src/source/index.js';
import { materializationFor } from '../../support/compiler-builders.js';
import { emptySchema, endNode, sourceWithNodes } from '../../support/source-builders.js';

const fieldSchema = (value: ValueSchema): ValueSchema => ({
  type: 'object',
  properties: { value },
  required: ['value'],
  additionalProperties: false,
});

const producer = (outputSchema: ValueSchema): ScriptSourceNode => ({
  kind: 'script',
  key: 'a-producer',
  requirementKey: 'producer',
  script: { key: 'producer', revision: 0 },
  input: {},
  inputSchema: emptySchema(),
  outputSchema,
  routes: { succeeded: 'b-consumer', failed: 'd-failed', cancelled: 'e-cancelled' },
});

const consumer = (selector: ValueSelector, inputSchema: ValueSchema): ScriptSourceNode => ({
  kind: 'script',
  key: 'b-consumer',
  requirementKey: 'consumer',
  script: { key: 'consumer', revision: 0 },
  input: { value: selector },
  inputSchema: fieldSchema(inputSchema),
  outputSchema: emptySchema(),
  routes: { succeeded: 'c-done', failed: 'c-done', cancelled: 'c-done' },
});

const dataflowSource = (
  selector: ValueSelector,
  producerSchema: ValueSchema,
  consumerSchema: ValueSchema,
  routeAllToConsumer = false,
): PipelineSourcePackage => {
  const first = producer(producerSchema);
  const second = consumer(selector, consumerSchema);
  return routeAllToConsumer
    ? sourceWithNodes([
        {
          ...first,
          routes: { succeeded: 'b-consumer', failed: 'b-consumer', cancelled: 'e-cancelled' },
        },
        second,
        endNode('c-done'),
        endNode('e-cancelled'),
      ])
    : sourceWithNodes([
        first,
        second,
        endNode('c-done'),
        endNode('d-failed'),
        endNode('e-cancelled'),
      ]);
};

const diagnosticCodes = (source: PipelineSourcePackage) => {
  const result = compilePipeline(source, materializationFor(source));
  if (result.ok) {
    return [];
  }
  expect(Object.keys(result).toSorted()).toEqual(['diagnostics', 'ok']);
  return result.diagnostics.map(({ code, path }) => ({ code, path }));
};

describe('compiler dataflow matrix', () => {
  const compatibilityCases = [
    {
      name: 'accepts exact schema equality',
      producer: { type: 'string' } as const,
      consumer: { type: 'string' } as const,
      diagnostics: [],
    },
    {
      name: 'accepts bounded integer to number widening',
      producer: { type: 'integer', minimum: 1, maximum: 3 } as const,
      consumer: { type: 'number', minimum: 0, maximum: 4 } as const,
      diagnostics: [],
    },
    {
      name: 'rejects number to integer narrowing',
      producer: { type: 'number' } as const,
      consumer: { type: 'integer' } as const,
      diagnostics: [
        { code: 'DATA_SCHEMA_INCOMPATIBLE', path: '/modules/0/region/nodes/1/input/value' },
      ],
    },
    {
      name: 'rejects integer bounds outside the consumer number range',
      producer: { type: 'integer', minimum: -1, maximum: 3 } as const,
      consumer: { type: 'number', minimum: 0, maximum: 4 } as const,
      diagnostics: [
        { code: 'DATA_SCHEMA_INCOMPATIBLE', path: '/modules/0/region/nodes/1/input/value' },
      ],
    },
    {
      name: 'rejects enum widening',
      producer: { type: 'string', enum: ['only'] } as const,
      consumer: { type: 'string' } as const,
      diagnostics: [
        { code: 'DATA_SCHEMA_INCOMPATIBLE', path: '/modules/0/region/nodes/1/input/value' },
      ],
    },
    {
      name: 'rejects object-width subtyping',
      producer: {
        type: 'object',
        properties: { kept: { type: 'string' }, extra: { type: 'string' } },
        required: ['kept', 'extra'],
        additionalProperties: false,
      } as const,
      consumer: {
        type: 'object',
        properties: { kept: { type: 'string' } },
        required: ['kept'],
        additionalProperties: false,
      } as const,
      diagnostics: [
        { code: 'DATA_SCHEMA_INCOMPATIBLE', path: '/modules/0/region/nodes/1/input/value' },
      ],
    },
    {
      name: 'rejects union distribution',
      producer: { anyOf: [{ type: 'integer' }, { type: 'string' }] } as const,
      consumer: { type: 'number' } as const,
      diagnostics: [
        { code: 'DATA_SCHEMA_INCOMPATIBLE', path: '/modules/0/region/nodes/1/input/value' },
      ],
    },
    {
      name: 'rejects implicit scalar coercion',
      producer: { type: 'boolean' } as const,
      consumer: { type: 'string' } as const,
      diagnostics: [
        { code: 'DATA_SCHEMA_INCOMPATIBLE', path: '/modules/0/region/nodes/1/input/value' },
      ],
    },
  ];

  it.each(compatibilityCases)('$name', (testCase) => {
    const source = dataflowSource(
      { kind: 'nodeOutput', node: 'a-producer', pointer: '' },
      testCase.producer,
      testCase.consumer,
    );
    expect(diagnosticCodes(source)).toEqual(testCase.diagnostics);
  });

  it('rejects a node output without succeeded-route dominance', () => {
    const source = dataflowSource(
      { kind: 'nodeOutput', node: 'a-producer', pointer: '' },
      { type: 'string' },
      { type: 'string' },
      true,
    );
    expect(diagnosticCodes(source)).toEqual([
      { code: 'DATA_DOMINANCE', path: '/modules/0/region/nodes/1/input/value' },
    ]);
  });

  it('reports the exact invalid RFC 6901 projection', () => {
    const source = dataflowSource(
      { kind: 'nodeOutput', node: 'a-producer', pointer: '/missing' },
      { type: 'string' },
      { type: 'string' },
    );
    expect(diagnosticCodes(source)).toEqual([
      { code: 'DATA_POINTER_STATIC', path: '/modules/0/region/nodes/1/input/value/pointer' },
    ]);
  });

  it.each([
    {
      name: 'decodes escaped object tokens',
      pointer: '/a~1b/~0key',
      producer: {
        type: 'object',
        properties: {
          'a/b': {
            type: 'object',
            properties: { '~key': { type: 'string', enum: ['value'] } },
            required: ['~key'],
            additionalProperties: false,
          },
        },
        required: ['a/b'],
        additionalProperties: false,
      } as const,
      consumer: { type: 'string', enum: ['value'] } as const,
      diagnostics: [],
    },
    {
      name: 'accepts a guaranteed canonical array index',
      pointer: '/0',
      producer: {
        type: 'array',
        items: { type: 'boolean' },
        minItems: 1,
        maxItems: 1,
      } as const,
      consumer: { type: 'boolean' } as const,
      diagnostics: [],
    },
    {
      name: 'rejects a leading-zero array index',
      pointer: '/01',
      producer: {
        type: 'array',
        items: { type: 'boolean' },
        minItems: 2,
        maxItems: 2,
      } as const,
      consumer: { type: 'boolean' } as const,
      diagnostics: [
        {
          code: 'DATA_POINTER_STATIC',
          path: '/modules/0/region/nodes/1/input/value/pointer',
        },
      ],
    },
    {
      name: 'rejects traversal through a scalar',
      pointer: '/nested',
      producer: { type: 'string' } as const,
      consumer: { type: 'string' } as const,
      diagnostics: [
        {
          code: 'DATA_POINTER_STATIC',
          path: '/modules/0/region/nodes/1/input/value/pointer',
        },
      ],
    },
    {
      name: 'rejects an optional object property',
      pointer: '/optional',
      producer: {
        type: 'object',
        properties: { optional: { type: 'string' } },
        required: [],
        additionalProperties: false,
      } as const,
      consumer: { type: 'string' } as const,
      diagnostics: [
        {
          code: 'DATA_POINTER_STATIC',
          path: '/modules/0/region/nodes/1/input/value/pointer',
        },
      ],
    },
  ] as const)('$name', (testCase) => {
    const source = dataflowSource(
      { kind: 'nodeOutput', node: 'a-producer', pointer: testCase.pointer },
      testCase.producer,
      testCase.consumer,
    );
    expect(diagnosticCodes(source)).toEqual(testCase.diagnostics);
  });
});
