import { describe, expect, it } from 'vitest';

import type { PipelineSourcePackage, SourceNode, ValueSchema } from '../../../src/source/index.js';
import {
  childRegion,
  endNode,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';
import { expectValidSource, sourceDiagnostics } from '../../support/source-validation.js';

const sourceWithRegionOutput = (
  exitOutputSchema: ValueSchema,
  regionOutputSchema: ValueSchema,
): PipelineSourcePackage => {
  const source = sourceWithNodes([endNode()]);
  const module = source.modules[0];
  return {
    ...source,
    modules: [
      {
        ...module,
        outputSchema: regionOutputSchema,
        region: {
          ...module.region,
          outputSchema: regionOutputSchema,
          exits: [{ outcome: 'ok', outputSchema: exitOutputSchema }],
        },
      },
    ],
  };
};

describe('source region graph', () => {
  it.each([
    ['exact equality', { type: 'string' }, { type: 'string' }],
    [
      'safe integer-to-number widening',
      { type: 'integer', minimum: 1, maximum: 3 },
      { type: 'number', minimum: 0, maximum: 4 },
    ],
  ] as const)('accepts region exit output schemas by %s', (_name, exitSchema, regionSchema) => {
    expect(
      expectValidSource(sourceWithRegionOutput(exitSchema, regionSchema)).source.modules,
    ).toHaveLength(1);
  });

  it('rejects an exit output schema not accepted by the region output schema', () => {
    const source = sourceWithRegionOutput({ type: 'number' }, { type: 'integer' });

    expect(sourceDiagnostics(source)).toContainEqual({
      code: 'DATA_SCHEMA_INCOMPATIBLE',
      path: '/modules/0/region/exits/0/outputSchema',
    });
  });

  it('keeps module-to-region input and output checks exact', () => {
    const source = sourceWithRegionOutput({ type: 'integer' }, { type: 'number' });
    const module = source.modules[0];
    const invalid: PipelineSourcePackage = {
      ...source,
      modules: [
        {
          ...module,
          outputSchema: { type: 'integer' },
          region: { ...module.region, inputSchema: { type: 'null' } },
        },
      ],
    };

    expect(sourceDiagnostics(invalid)).toEqual(
      expect.arrayContaining([
        { code: 'CANONICAL_INPUT', path: '/modules/0/region/inputSchema' },
        { code: 'CANONICAL_INPUT', path: '/modules/0/region/outputSchema' },
      ]),
    );
  });

  it.each([
    ['unknown entry', 'entry', '/modules/0/region/entry'],
    ['unknown target', 'target', '/modules/0/region/nodes/0/routes/completed'],
    ['unreachable node', 'unreachable', '/modules/0/region/nodes/2'],
  ] as const)('reports an exact local diagnostic for %s', (_name, fault, path) => {
    const base = sourceForNode(sourceNodeBuilders.wait());
    const module = base.modules[0];
    const region = module.region;
    const wait = region.nodes[0];
    if (wait?.kind !== 'wait') {
      throw new TypeError('Expected normalized wait node.');
    }
    const nodes: [SourceNode, ...SourceNode[]] =
      fault === 'target'
        ? [{ ...wait, routes: { ...wait.routes, completed: 'missing' } }, ...region.nodes.slice(1)]
        : fault === 'unreachable'
          ? [...region.nodes, endNode('orphan')]
          : [...region.nodes];
    const source = {
      ...base,
      modules: [
        {
          ...module,
          region: { ...region, entry: fault === 'entry' ? 'missing' : region.entry, nodes },
        },
      ],
    } satisfies PipelineSourcePackage;

    expect(sourceDiagnostics(source)).toContainEqual({ code: 'CANONICAL_INPUT', path });
  });

  it('rejects a reachable cycle with no path to an end', () => {
    const wait = sourceNodeBuilders.wait();
    const cycling: SourceNode = {
      ...wait,
      routes: { completed: 'activity', cancelled: 'activity' },
    };

    expect(sourceDiagnostics(sourceWithNodes([cycling]))).toContainEqual({
      code: 'CANONICAL_INPUT',
      path: '/modules/0/region/nodes/0',
    });
  });

  it('rejects reachable self-cycles and multi-node SCCs even when each has an exit', () => {
    const selfCycle: SourceNode = {
      kind: 'wait',
      key: 'a',
      wait: { kind: 'duration', durationMs: 1 },
      routes: { completed: 'a', cancelled: 'done' },
    };
    const left: SourceNode = {
      kind: 'wait',
      key: 'a',
      wait: { kind: 'duration', durationMs: 1 },
      routes: { completed: 'b', cancelled: 'done' },
    };
    const right: SourceNode = {
      kind: 'wait',
      key: 'b',
      wait: { kind: 'duration', durationMs: 1 },
      routes: { completed: 'a', cancelled: 'done' },
    };

    for (const nodes of [
      [selfCycle, endNode()],
      [left, right, endNode()],
    ] as const) {
      expect(sourceDiagnostics(sourceWithNodes(nodes))).toContainEqual({
        code: 'CANONICAL_INPUT',
        path: '/modules/0/region/nodes/0',
      });
    }
  });

  it('rejects a direct SCC inside a nested region independently', () => {
    const repeat = sourceNodeBuilders.repeat();
    const left: SourceNode = {
      kind: 'wait',
      key: 'a',
      wait: { kind: 'duration', durationMs: 1 },
      routes: { completed: 'b', cancelled: 'done' },
    };
    const right: SourceNode = {
      kind: 'wait',
      key: 'b',
      wait: { kind: 'duration', durationMs: 1 },
      routes: { completed: 'a', cancelled: 'done' },
    };
    const nested: SourceNode = {
      ...repeat,
      body: {
        ...repeat.body,
        entry: 'a',
        nodes: [left, right, endNode('done', 'value')],
      },
    };

    expect(sourceDiagnostics(sourceForNode(nested))).toContainEqual({
      code: 'CANONICAL_INPUT',
      path: '/modules/0/region/nodes/0/body/nodes/0',
    });
  });

  it('checks nested regions independently while the structured node is atomic outside', () => {
    const parallel = sourceNodeBuilders.parallel();
    const [first, second, ...rest] = parallel.branches;
    const invalid: SourceNode = {
      ...parallel,
      branches: [{ ...first, region: { ...first.region, entry: 'missing' } }, second, ...rest],
    };

    expect(sourceDiagnostics(sourceForNode(invalid))).toContainEqual({
      code: 'CANONICAL_INPUT',
      path: '/modules/0/region/nodes/0/branches/0/region/entry',
    });
  });

  it('uses the dedicated failed-exit diagnostic', () => {
    const repeat = sourceNodeBuilders.repeat();
    const invalid: SourceNode = {
      ...repeat,
      body: childRegion('body', 'failed'),
      bodyExits: [{ outcome: 'failed', classification: 'failed' }],
    };

    expect(sourceDiagnostics(sourceForNode(invalid))).toContainEqual({
      code: 'DATA_FAILED_EXIT_SCHEMA',
      path: '/modules/0/region/nodes/0/body/exits/0',
    });
  });
});
