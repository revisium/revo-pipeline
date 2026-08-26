import { describe, expect, it } from 'vitest';

import type { SourceNode } from '../../../src/source/index.js';
import {
  childRegion,
  endNode,
  nonEmptyNodes,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';
import { expectValidSource, sourceDiagnostics } from '../../support/source-validation.js';

describe('source selectors and contexts', () => {
  it('accepts every base-context selector and rejects context-only selectors', () => {
    const validEnd: SourceNode = {
      kind: 'end',
      id: 'done',
      outcome: 'ok',
      output: {
        literal: { kind: 'literal', value: { ok: true } },
        module: { kind: 'moduleInput', pointer: '' },
        scope: { kind: 'scopeInput', pointer: '' },
        output: { kind: 'nodeOutput', node: 'activity', pointer: '' },
        failure: { kind: 'nodeFailure', node: 'activity', pointer: '/code' },
      },
    };
    expectValidSource(sourceWithNodes([sourceNodeBuilders.agent(), validEnd]));

    for (const selector of [
      { kind: 'regionOutput', pointer: '' },
      { kind: 'repeat', value: 'iteration', pointer: '' },
      { kind: 'map', value: 'item', pointer: '' },
    ] as const) {
      const invalidEnd: SourceNode = {
        kind: 'end',
        id: 'done',
        outcome: 'ok',
        output: { value: selector },
      };
      expect(sourceDiagnostics(sourceWithNodes([invalidEnd]))).toContainEqual({
        code: 'DATA_SCOPE',
        path: '/modules/0/region/nodes/0/output/value',
      });
    }
  });

  it('accepts repeat, map, and region-output selectors in their child-exit scopes', () => {
    const repeat = sourceNodeBuilders.repeat();
    expect(
      expectValidSource(
        sourceForNode({
          ...repeat,
          nextInput: {
            iteration: { kind: 'repeat', value: 'iteration', pointer: '' },
            previous: { kind: 'repeat', value: 'previousOutput', pointer: '' },
            output: { kind: 'regionOutput', pointer: '' },
          },
        }),
      ).source.modules,
    ).toHaveLength(1);

    const map = sourceNodeBuilders.map();
    expect(
      expectValidSource(
        sourceForNode({
          ...map,
          bodyInput: {
            item: { kind: 'map', value: 'item', pointer: '' },
            key: { kind: 'map', value: 'itemKey', pointer: '' },
          },
        }),
      ).source.modules,
    ).toHaveLength(1);
  });

  it('rejects repeat-result selectors in the pre-body initial input', () => {
    const repeat = sourceNodeBuilders.repeat();
    expect(
      sourceDiagnostics(
        sourceForNode({
          ...repeat,
          initialInput: {
            iteration: { kind: 'repeat', value: 'iteration', pointer: '' },
          },
        }),
      ),
    ).toContainEqual({
      code: 'DATA_SCOPE',
      path: '/modules/0/region/nodes/0/initialInput/iteration',
    });
  });

  it('reports missing producers and impossible static pointers precisely', () => {
    const missingProducer: SourceNode = {
      kind: 'end',
      id: 'done',
      outcome: 'ok',
      output: { value: { kind: 'nodeOutput', node: 'missing', pointer: '' } },
    };
    expect(sourceDiagnostics(sourceWithNodes([missingProducer]))).toContainEqual({
      code: 'DATA_SCOPE',
      path: '/modules/0/region/nodes/0/output/value/node',
    });

    const invalid: SourceNode = {
      ...sourceNodeBuilders.choice(),
      selector: { kind: 'moduleInput', pointer: '/missing' },
      otherwise: null,
    };
    expect(sourceDiagnostics(sourceForNode(invalid))).toContainEqual({
      code: 'DATA_POINTER_STATIC',
      path: '/modules/0/region/nodes/0/selector/pointer',
    });
  });

  it('validates a reverse 1800-map output dependency chain without recursive resolution', () => {
    const mapKey = (index: number): string => `map-${String(index).padStart(4, '0')}`;
    const maps = Array.from({ length: 1800 }, (_, index) => ({
      ...sourceNodeBuilders.map(),
      id: mapKey(index),
      body: childRegion(`${mapKey(index)}-body`, 'completed'),
      items:
        index === 1799
          ? { kind: 'literal' as const, value: [{ itemKey: 'seed' }] }
          : {
              kind: 'nodeOutput' as const,
              node: mapKey(index + 1),
              pointer: '/items' as const,
            },
      itemKeyPointer: '/itemKey' as const,
      routes: {
        completed: index === 0 ? 'done' : mapKey(index - 1),
        failed: 'failed',
        cancelled: 'cancelled',
      },
    })) satisfies SourceNode[];
    const source = sourceWithNodes(
      nonEmptyNodes([...maps, endNode(), endNode('failed'), endNode('cancelled')]),
      mapKey(1799),
    );

    expect(expectValidSource(source).source.modules[0]?.region.nodes).toHaveLength(1803);
  });
});
