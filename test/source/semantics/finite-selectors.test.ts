import { describe, expect, it } from 'vitest';

import type { JsonPointer, JsonScalar } from '../../../src/foundation/index.js';
import {
  type PipelineSourcePackage,
  type PipelineSourceValidationResult,
  type SourceNode,
  type ValueSchema,
  validatePipelineSource,
} from '../../../src/source/index.js';
import {
  endNode,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';

const finiteNodeChoice = (
  node: string,
  pointer: JsonPointer,
  values: readonly [JsonScalar, ...JsonScalar[]],
): SourceNode => ({
  kind: 'choice',
  id: 'choose',
  selector: { kind: 'nodeOutput', node, pointer },
  cases: [{ key: 'covered', when: { kind: 'oneOf', values }, target: 'done' }],
  otherwise: null,
});

const diagnostics = (result: PipelineSourceValidationResult) =>
  result.ok ? [] : result.diagnostics.map(({ code, path }) => ({ code, path }));

const sourceWithInput = (
  inputSchema: ValueSchema,
  nodes: readonly [SourceNode, ...SourceNode[]],
  entry = nodes[0].id,
): PipelineSourcePackage => {
  const source = sourceWithNodes(nodes, entry);
  const module = source.modules[0];
  if (module === undefined) {
    throw new TypeError('Expected module fixture.');
  }
  return {
    ...source,
    modules: [
      {
        ...module,
        inputSchema,
        region: { ...module.region, inputSchema },
      },
    ],
  };
};

const mapExample = (): Extract<SourceNode, { readonly kind: 'map' }> => {
  return sourceNodeBuilders.map();
};

describe('finite structured selector schemas', () => {
  it.each(['left', 'right'] as const)(
    'projects every parallel branch status through /branches/%s/status',
    (branch) => {
      const example = sourceNodeBuilders.parallel();
      const parallel: SourceNode = {
        ...example,
        id: 'parallel',
        routes: {
          completed: 'choose',
          impossible: 'choose',
          failed: 'choose',
          cancelled: 'choose',
        },
      };
      const result = validatePipelineSource(
        sourceWithNodes(
          [
            parallel,
            finiteNodeChoice('parallel', `/branches/${branch}/status`, [
              'completed',
              'failed',
              'cancelled',
            ]),
            endNode(),
          ],
          'parallel',
        ),
      );

      expect(result.ok).toBe(true);
    },
  );

  it.each(['left', 'right'] as const)(
    'projects every explicit-consensus participant status through /votes/%s/status',
    (participant) => {
      const example = sourceNodeBuilders.consensus();
      const consensus: SourceNode = {
        ...example,
        id: 'consensus',
        routes: {
          approved: 'choose',
          rejected: 'choose',
          inconclusive: 'choose',
          participantFailed: 'choose',
          cancelled: 'choose',
        },
      };
      const result = validatePipelineSource(
        sourceWithNodes(
          [
            consensus,
            finiteNodeChoice('consensus', `/votes/${participant}/status`, [
              'vote',
              'failed',
              'cancelled',
            ]),
            endNode(),
          ],
          'consensus',
        ),
      );

      expect(result.ok).toBe(true);
    },
  );

  it('projects exact human-gate and map result discriminators', () => {
    const gateExample = sourceNodeBuilders.humanGate();
    const mapNodeExample = sourceNodeBuilders.map();
    const [answerRoute] = gateExample.routes.answers;
    const gate: SourceNode = {
      ...gateExample,
      id: 'gate',
      routes: {
        answers: [{ ...answerRoute, target: 'choose' }],
        cancelled: 'choose',
      },
    };
    const gateResult = validatePipelineSource(
      sourceWithNodes(
        [gate, finiteNodeChoice('gate', '/kind', ['answer', 'deadline']), endNode()],
        'gate',
      ),
    );

    const map: SourceNode = {
      ...mapNodeExample,
      id: 'map',
      items: { kind: 'literal', value: [false, 'x'] },
      routes: { completed: 'choose', failed: 'choose', cancelled: 'choose' },
    };
    const mapResult = validatePipelineSource(
      sourceWithNodes(
        [
          map,
          finiteNodeChoice('map', '/items/0/status', ['succeeded', 'failed', 'cancelled']),
          endNode(),
        ],
        'map',
      ),
    );

    expect(gateResult.ok).toBe(false);
    expect(mapResult.ok).toBe(true);
  });

  it('derives repeat iteration coverage from maximumIterations', () => {
    const example = sourceNodeBuilders.repeat();
    const repeatWithMaximum = (maximumIterations: number): SourceNode => ({
      ...example,
      maximumIterations,
      body: {
        ...example.body,
        entry: 'choose',
        nodes: [
          {
            kind: 'choice',
            id: 'choose',
            selector: { kind: 'repeat', value: 'iteration', pointer: '' },
            cases: [{ key: 'zero', when: { kind: 'equals', value: 0 }, target: 'body-done' }],
            otherwise: null,
          },
          endNode('body-done', 'value'),
        ],
      },
    });

    expect(validatePipelineSource(sourceForNode(repeatWithMaximum(1))).ok).toBe(true);
    expect(diagnostics(validatePipelineSource(sourceForNode(repeatWithMaximum(2))))).toContainEqual(
      {
        code: 'DATA_SCHEMA_INCOMPATIBLE',
        path: '/modules/0/region/nodes/0/body/nodes/1/otherwise',
      },
    );
  });

  it('unions every heterogeneous literal map item schema', () => {
    const example = mapExample();
    const mapWithCases = (values: readonly [JsonScalar, ...JsonScalar[]]): SourceNode => ({
      ...example,
      items: { kind: 'literal', value: [false, 'x'] },
      body: {
        ...example.body,
        entry: 'choose',
        nodes: [
          {
            kind: 'choice',
            id: 'choose',
            selector: { kind: 'map', value: 'item', pointer: '' },
            cases: [{ key: 'covered', when: { kind: 'oneOf', values }, target: 'body-done' }],
            otherwise: null,
          },
          endNode('body-done', 'completed'),
        ],
      },
    });

    expect(validatePipelineSource(sourceForNode(mapWithCases([false, true, 'x']))).ok).toBe(true);
    expect(
      diagnostics(validatePipelineSource(sourceForNode(mapWithCases([false, true])))),
    ).toContainEqual({
      code: 'DATA_SCHEMA_INCOMPATIBLE',
      path: '/modules/0/region/nodes/0/body/nodes/1/otherwise',
    });
  });

  it('unions item schemas across guaranteed array alternatives', () => {
    const inputSchema: ValueSchema = {
      anyOf: [
        { type: 'array', items: { type: 'boolean' }, minItems: 1, maxItems: 2 },
        {
          type: 'array',
          items: { type: 'string', enum: ['x'] },
          minItems: 1,
          maxItems: 3,
        },
      ],
    };
    const example = mapExample();
    const map: SourceNode = {
      ...example,
      items: { kind: 'moduleInput', pointer: '' },
      body: {
        ...example.body,
        entry: 'choose',
        nodes: [
          {
            kind: 'choice',
            id: 'choose',
            selector: { kind: 'map', value: 'item', pointer: '' },
            cases: [
              {
                key: 'covered',
                when: { kind: 'oneOf', values: [false, true, 'x'] },
                target: 'body-done',
              },
            ],
            otherwise: null,
          },
          endNode('body-done', 'completed'),
        ],
      },
    };

    expect(validatePipelineSource(sourceWithInput(inputSchema, [map, endNode()]))).toMatchObject({
      ok: true,
    });
  });

  it('rejects a map items selector that does not guarantee an array', () => {
    const example = mapExample();
    const map: SourceNode = {
      ...example,
      items: { kind: 'literal', value: false },
      body: {
        ...example.body,
        entry: 'choose',
        nodes: [
          {
            kind: 'choice',
            id: 'choose',
            selector: { kind: 'map', value: 'item', pointer: '' },
            cases: [{ key: 'null', when: { kind: 'equals', value: null }, target: 'body-done' }],
            otherwise: null,
          },
          endNode('body-done', 'completed'),
        ],
      },
    };

    expect(diagnostics(validatePipelineSource(sourceForNode(map)))).toContainEqual({
      code: 'DATA_SCHEMA_INCOMPATIBLE',
      path: '/modules/0/region/nodes/0/items',
    });
  });

  it('preserves guaranteed map result indexes from non-literal array schemas', () => {
    const inputSchema: ValueSchema = {
      anyOf: [
        { type: 'array', items: { type: 'boolean' }, minItems: 1, maxItems: 1 },
        { type: 'array', items: { type: 'boolean' }, minItems: 2, maxItems: 2 },
      ],
    };
    const example = mapExample();
    const map: SourceNode = {
      ...example,
      items: { kind: 'moduleInput', pointer: '' },
      routes: { completed: 'choose', failed: 'choose', cancelled: 'choose' },
    };
    const source = sourceWithInput(
      inputSchema,
      [
        map,
        finiteNodeChoice('activity', '/items/0/status', ['succeeded', 'failed', 'cancelled']),
        endNode(),
      ],
      'activity',
    );

    expect(validatePipelineSource(source)).toMatchObject({ ok: true });

    const secondIndex = sourceWithInput(
      inputSchema,
      [
        map,
        finiteNodeChoice('activity', '/items/1/status', ['succeeded', 'failed', 'cancelled']),
        endNode(),
      ],
      'activity',
    );
    expect(diagnostics(validatePipelineSource(secondIndex))).toContainEqual({
      code: 'DATA_POINTER_STATIC',
      path: '/modules/0/region/nodes/1/selector/pointer',
    });
  });

  it('rejects an anyOf map input with a non-array alternative', () => {
    const inputSchema: ValueSchema = {
      anyOf: [
        { type: 'array', items: { type: 'boolean' }, minItems: 1, maxItems: 1 },
        { type: 'boolean' },
      ],
    };
    const map: SourceNode = {
      ...mapExample(),
      items: { kind: 'moduleInput', pointer: '' },
    };

    expect(
      diagnostics(validatePipelineSource(sourceWithInput(inputSchema, [map, endNode()]))),
    ).toContainEqual({
      code: 'DATA_SCHEMA_INCOMPATIBLE',
      path: '/modules/0/region/nodes/0/items',
    });
  });

  it('reports a known producer without a successful output as DATA_SCOPE', () => {
    const choice: SourceNode = {
      kind: 'choice',
      id: 'choose',
      selector: { kind: 'nodeOutput', node: 'done', pointer: '' },
      cases: [{ key: 'null', when: { kind: 'equals', value: null }, target: 'done' }],
      otherwise: null,
    };

    expect(
      diagnostics(validatePipelineSource(sourceWithNodes([choice, endNode()], 'choose'))),
    ).toContainEqual({
      code: 'DATA_SCOPE',
      path: '/modules/0/region/nodes/0/selector/node',
    });
  });
});
