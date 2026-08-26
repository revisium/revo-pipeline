import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type {
  PipelineSourcePackage,
  SourceNode,
  ValueMapping,
  ValueSchema,
} from '../../../src/source/index.js';
import { materializationFor } from '../../support/compiler-builders.js';
import {
  emptySchema,
  endNode,
  nonEmptyNodes,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';

const stringField = (key = 'value'): ValueSchema => ({
  type: 'object',
  properties: { [key]: { type: 'string' } },
  required: [key],
  additionalProperties: false,
});

const compile = (source: PipelineSourcePackage) =>
  compilePipeline(source, materializationFor(source));

const successful = (source: PipelineSourcePackage) => {
  const result = compile(source);
  if (!result.ok) {
    throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
  }
  return result;
};

const diagnosticCodes = (source: PipelineSourcePackage): readonly string[] => {
  const result = compile(source);
  return result.ok ? [] : result.diagnostics.map(({ code }) => code);
};

const routeSource = (
  selectorKind: 'nodeOutput' | 'nodeFailure',
  route: 'succeeded' | 'failed' | 'cancelled',
): PipelineSourcePackage => {
  const producer = {
    ...sourceNodeBuilders.script(),
    id: 'a-producer',
    outputSchema: stringField(),
    routes: {
      succeeded: route === 'succeeded' ? 'b-consumer' : 'succeeded-end',
      failed: route === 'failed' ? 'b-consumer' : 'failed-end',
      cancelled: route === 'cancelled' ? 'b-consumer' : 'cancelled-end',
    },
  } satisfies SourceNode;
  const selector =
    selectorKind === 'nodeOutput'
      ? { kind: 'nodeOutput' as const, node: producer.id, pointer: '/value' as const }
      : { kind: 'nodeFailure' as const, node: producer.id, pointer: '/code' as const };
  const consumer = {
    ...sourceNodeBuilders.script(),
    id: 'b-consumer',
    requirementKey: 'consumer',
    script: { id: 'script:consumer', version: 1 },
    input: { value: selector },
    inputSchema: stringField(),
  } satisfies SourceNode;
  const statusEnds = [
    ['succeeded', endNode('succeeded-end')],
    ['failed', endNode('failed-end')],
    ['cancelled', endNode('cancelled-end')],
  ] as const;
  return sourceWithNodes([
    producer,
    consumer,
    ...statusEnds.filter(([status]) => status !== route).map(([, node]) => node),
    endNode(),
  ]);
};

const reverseOrderedDominanceSource = (): PipelineSourcePackage => {
  const producer = {
    ...sourceNodeBuilders.script(),
    id: 'n0',
    outputSchema: stringField(),
    routes: { succeeded: 'n1', failed: 'n510', cancelled: 'n511' },
  } satisfies SourceNode;
  const consumers = Array.from({ length: 508 }, (_, index) => {
    const nodeIndex = index + 1;
    const next = nodeIndex === 508 ? 'n509' : `n${nodeIndex + 1}`;
    return {
      ...sourceNodeBuilders.script(next),
      id: `n${nodeIndex}`,
      requirementKey: 'consumer',
      script: { id: 'script:consumer-script', version: 1 },
      input: {
        value: { kind: 'nodeOutput' as const, node: producer.id, pointer: '/value' as const },
      },
      inputSchema: stringField(),
    } satisfies SourceNode;
  });
  const nodes = nonEmptyNodes(
    [producer, ...consumers, endNode('n509'), endNode('n510'), endNode('n511')].reverse(),
  );
  return {
    ...sourceWithNodes(nodes, producer.id),
    maximumTotalActivities: consumers.length + 1,
  };
};

describe('compiler selector scopes and route dominance', () => {
  it.each([
    ['nodeOutput', 'succeeded', []],
    ['nodeOutput', 'failed', ['DATA_DOMINANCE']],
    ['nodeOutput', 'cancelled', ['DATA_DOMINANCE']],
    ['nodeFailure', 'succeeded', ['DATA_DOMINANCE']],
    ['nodeFailure', 'failed', []],
    ['nodeFailure', 'cancelled', ['DATA_DOMINANCE']],
  ] as const)('%s on the %s route', (selector, route, expected) => {
    expect(diagnosticCodes(routeSource(selector, route))).toEqual(expected);
  });

  it('compiles a reverse-ordered 512-node dominance chain at the source cap', () => {
    const result = successful(reverseOrderedDominanceSource());

    expect(result.program.modules[0]?.region.nodes).toHaveLength(512);
  });

  it('handles a status-dominated diamond and rejects a producer bypass', () => {
    const producer = {
      ...sourceNodeBuilders.script(),
      id: 'producer',
      outputSchema: stringField(),
      routes: { succeeded: 'split', failed: 'failed', cancelled: 'cancelled' },
    } satisfies SourceNode;
    const consumer = {
      ...sourceNodeBuilders.script(),
      id: 'consumer',
      requirementKey: 'consumer',
      script: { id: 'script:consumer', version: 1 },
      input: {
        value: { kind: 'nodeOutput' as const, node: producer.id, pointer: '/value' as const },
      },
      inputSchema: stringField(),
    } satisfies SourceNode;
    const split = {
      ...sourceNodeBuilders.choice('left'),
      id: 'split',
      otherwise: 'right',
    } satisfies SourceNode;
    const diamond = sourceWithNodes([
      producer,
      split,
      { ...sourceNodeBuilders.wait('consumer'), id: 'left' },
      { ...sourceNodeBuilders.wait('consumer'), id: 'right' },
      consumer,
      endNode(),
      endNode('failed'),
      endNode('cancelled'),
    ]);

    expect(compile(diamond)).toMatchObject({ ok: true });

    const bypass = sourceWithNodes(
      [
        { ...split, cases: [{ ...split.cases[0], target: producer.id }], otherwise: consumer.id },
        {
          ...producer,
          routes: { succeeded: consumer.id, failed: 'failed', cancelled: 'cancelled' },
        },
        consumer,
        endNode(),
        endNode('failed'),
        endNode('cancelled'),
      ],
      split.id,
    );
    expect(diagnosticCodes(bypass)).toContain('DATA_DOMINANCE');
  });

  it('resolves moduleInput and scopeInput independently', () => {
    const inputSchema = stringField();
    const consumer = {
      ...sourceNodeBuilders.script(),
      input: {
        module: { kind: 'moduleInput', pointer: '/value' },
        scope: { kind: 'scopeInput', pointer: '/value' },
      },
      inputSchema: {
        type: 'object',
        properties: { module: { type: 'string' }, scope: { type: 'string' } },
        required: ['module', 'scope'],
        additionalProperties: false,
      },
    } satisfies SourceNode;
    const source = sourceForNode(consumer);
    const module = source.modules[0];
    const configured: PipelineSourcePackage = {
      ...source,
      modules: [
        {
          ...module,
          inputSchema,
          region: { ...module.region, inputSchema },
        },
      ],
    };

    expect(compile(configured)).toMatchObject({ ok: true });
  });

  it('resolves repeat, map, and post-child regionOutput scopes', () => {
    const repeatInput: ValueSchema = {
      type: 'object',
      properties: {
        iteration: { type: 'integer', minimum: 0, maximum: 1 },
        previous: emptySchema(),
        region: emptySchema(),
      },
      required: [],
      additionalProperties: false,
    };
    const repeat = sourceNodeBuilders.repeat();
    const repeatNode: SourceNode = {
      ...repeat,
      body: { ...repeat.body, inputSchema: repeatInput },
      nextInput: {
        iteration: { kind: 'repeat', value: 'iteration', pointer: '' },
        previous: { kind: 'repeat', value: 'previousOutput', pointer: '' },
        region: { kind: 'regionOutput', pointer: '' },
      },
    };

    const map = sourceNodeBuilders.map();
    const mapInput: ValueSchema = {
      type: 'object',
      properties: {
        item: { type: 'string', enum: ['first'] },
        key: { type: 'string', enum: ['first'] },
      },
      required: ['item', 'key'],
      additionalProperties: false,
    };
    const mapNode: SourceNode = {
      ...map,
      items: { kind: 'literal', value: ['first'] },
      body: { ...map.body, inputSchema: mapInput },
      bodyInput: {
        item: { kind: 'map', value: 'item', pointer: '' },
        key: { kind: 'map', value: 'itemKey', pointer: '' },
      },
    };

    expect(compile(sourceForNode(repeatNode))).toMatchObject({ ok: true });
    expect(compile(sourceForNode(mapNode))).toMatchObject({ ok: true });
  });

  it('normalizes an omitted child input schema to the shared empty schema', () => {
    const parallel = sourceNodeBuilders.parallel();
    const [first, second] = parallel.branches;
    const { inputSchema: _, ...regionWithoutInput } = first.region;
    const source = sourceForNode({
      ...parallel,
      branches: [{ ...first, region: regionWithoutInput }, second],
    });
    const result = successful(source);
    const emitted = result.program.modules[0].region.nodes.find(
      (node) => node.kind === 'parallel' && node.mode === 'generic',
    );
    expect(emitted?.kind === 'parallel' ? emitted.branches[0].region.inputSchema : null).toEqual(
      emptySchema(),
    );
  });

  it.each([
    ['regionOutput', { kind: 'regionOutput', pointer: '' }],
    ['repeat', { kind: 'repeat', value: 'iteration', pointer: '' }],
    ['map', { kind: 'map', value: 'item', pointer: '' }],
  ] as const)('rejects %s outside its structured scope', (_name, selector) => {
    const output: ValueMapping = { value: selector };
    const result = compilePipeline(sourceWithNodes([{ ...endNode(), output }]), null);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ family: 'DATA', code: 'DATA_SCOPE' }],
    });
  });
});
