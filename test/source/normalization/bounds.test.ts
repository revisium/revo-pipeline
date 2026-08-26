import { describe, expect, it } from 'vitest';

import {
  type PipelineSourcePackage,
  type RepeatCondition,
  type SourceNode,
  type SourceRegion,
  type ValueMapping,
  type ValueSchema,
  validatePipelineSource,
} from '../../../src/source/index.js';
import {
  agentSource,
  emptySchema,
  endNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';

const resultOf = (source: unknown) => validatePipelineSource(source);
const diagnosticsOf = (source: unknown) => {
  const result = resultOf(source);
  if (result.ok) {
    throw new Error('Expected boundary diagnostics.');
  }
  return result.diagnostics.map(({ code, path }) => ({ code, path }));
};

const nestedSchema = (depth: number): ValueSchema => {
  let schema: ValueSchema = { type: 'null' };
  for (let index = 0; index < depth; index += 1) {
    schema = { type: 'array', items: schema };
  }
  return schema;
};

const nestedCondition = (depth: number): RepeatCondition => {
  let condition: RepeatCondition = {
    kind: 'exists',
    selector: { kind: 'repeat', value: 'iteration', pointer: '' },
  };
  for (let index = 0; index < depth; index += 1) {
    condition = { kind: 'not', condition };
  }
  return condition;
};

const nestedRepeat = (depth: number): SourceNode => {
  const example = sourceNodeBuilders.repeat();
  let body: SourceRegion = {
    key: `body-${depth}`,
    inputSchema: emptySchema(),
    entry: `body-${depth}-done`,
    outputSchema: emptySchema(),
    exits: [{ outcome: 'value', outputSchema: emptySchema() }],
    nodes: [endNode(`body-${depth}-done`, 'value')],
  };
  for (let index = 0; index < depth; index += 1) {
    const nested: SourceNode = {
      ...example,
      id: `repeat-${String(index).padStart(2, '0')}`,
      body,
      routes: {
        completed: `body-${index}-done`,
        exhausted: `body-${index}-done`,
        failed: `body-${index}-done`,
        cancelled: `body-${index}-done`,
      },
    };
    body = {
      key: `body-${String(index).padStart(2, '0')}`,
      inputSchema: emptySchema(),
      entry: nested.id,
      outputSchema: emptySchema(),
      exits: [{ outcome: 'value', outputSchema: emptySchema() }],
      nodes: [nested, endNode(`body-${index}-done`, 'value')],
    };
  }
  const root = body.nodes[0];
  if (root?.kind !== 'repeat') {
    throw new TypeError('Expected nested repeat root.');
  }
  return {
    ...root,
    id: 'activity',
    routes: { completed: 'done', exhausted: 'done', failed: 'done', cancelled: 'done' },
  };
};

describe('source materialization boundaries', () => {
  it('accepts envelope arrays beyond the standalone portable limit when explicitly bounded', () => {
    const nodes: SourceNode[] = Array.from({ length: 1_024 }, (_, index) => {
      const key = `n${String(index).padStart(4, '0')}`;
      const target = index === 1_023 ? 'zdone' : `n${String(index + 1).padStart(4, '0')}`;
      return {
        kind: 'wait',
        id: key,
        wait: { kind: 'duration', durationMs: 0 },
        routes: { completed: target, cancelled: target },
      };
    });
    const [first, ...rest] = nodes;
    if (first === undefined) {
      throw new TypeError('Expected generated source nodes.');
    }
    const source = {
      ...sourceWithNodes([first, ...rest, endNode('zdone')], 'n0000'),
      maximumTotalActivities: 1_024,
    };

    expect(resultOf(source).ok).toBe(true);
  });

  it('enforces 64 own envelope keys before schema dispatch', () => {
    const source: Record<string, unknown> = { ...agentSource() };
    for (let index = 0; index < 60; index += 1) {
      source[`extra${index}`] = index;
    }

    expect(diagnosticsOf(source)).toEqual([{ code: 'BOUND_EXCEEDED', path: '' }]);
  });

  it('pins independent ValueSchema and structural nesting limits', () => {
    const base = agentSource();
    const module = base.modules[0];
    const agent = module.region.nodes[0];
    if (agent?.kind !== 'agent') {
      throw new TypeError('Expected agent fixture.');
    }
    const withSchema = (depth: number): PipelineSourcePackage => ({
      ...base,
      modules: [
        {
          ...module,
          region: {
            ...module.region,
            nodes: [
              {
                ...agent,
                inputSchema: nestedSchema(depth),
              },
              ...module.region.nodes.slice(1),
            ],
          },
        },
      ],
    });

    expect(resultOf(withSchema(16)).ok).toBe(true);
    expect(diagnosticsOf(withSchema(17))[0]?.code).toBe('BOUND_EXCEEDED');
    expect(resultOf(sourceWithNodes([nestedRepeat(32), endNode()]))).toMatchObject({ ok: true });
    expect(diagnosticsOf(sourceWithNodes([nestedRepeat(33), endNode()]))).toContainEqual(
      expect.objectContaining({ code: 'BOUND_EXCEEDED' }),
    );
  });

  it('bounds RepeatCondition nesting separately from Region nesting', () => {
    const repeat = sourceNodeBuilders.repeat();

    expect(
      resultOf(sourceWithNodes([{ ...repeat, continueWhen: nestedCondition(32) }, endNode()])).ok,
    ).toBe(true);
    expect(
      diagnosticsOf(sourceWithNodes([{ ...repeat, continueWhen: nestedCondition(33) }, endNode()])),
    ).toContainEqual(expect.objectContaining({ code: 'BOUND_EXCEEDED' }));
  });

  it('shares one cumulative portable-value allowance across embedded literals', () => {
    const sourceWithLiteralCount = (count: number): PipelineSourcePackage => {
      const base = agentSource();
      const module = base.modules[0];
      const agent = module.region.nodes[0];
      if (agent?.kind !== 'agent') {
        throw new TypeError('Expected agent fixture.');
      }
      const input: ValueMapping = {};
      for (let index = 0; index < count; index += 1) {
        input[`v${String(index).padStart(2, '0')}`] = {
          kind: 'literal',
          value: Array.from({ length: 1_024 }, () => null),
        };
      }
      return {
        ...base,
        modules: [
          {
            ...module,
            region: {
              ...module.region,
              nodes: [
                {
                  ...agent,
                  input,
                },
                ...module.region.nodes.slice(1),
              ],
            },
          },
        ],
      };
    };

    expect(resultOf(sourceWithLiteralCount(63)).ok).toBe(true);
    const overflow = diagnosticsOf(sourceWithLiteralCount(64)).find(
      ({ code }) => code === 'CANONICAL_INPUT',
    );
    expect(overflow?.path).toMatch(/^\/modules\/0\/region\/nodes\/0\/input\/v63\/value\//u);
  });
});
