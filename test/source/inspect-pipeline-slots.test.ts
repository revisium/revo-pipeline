import { describe, expect, it } from 'vitest';

import { inspectPipelineSlots } from '../../src/index.js';
import { validatePipelineSource } from '../../src/source/index.js';
import {
  endNode,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../support/source-builders.js';

const promptSchema = {
  type: 'object' as const,
  properties: { prompt: { type: 'string' as const } },
  required: ['prompt'],
  additionalProperties: false,
};

describe('inspectPipelineSlots', () => {
  it('returns only reachable agent-node slots, sorted by node ID and strategy kind', () => {
    const source = sourceWithNodes([
      {
        ...sourceNodeBuilders.agent('second'),
        id: 'first',
        strategies: [
          {
            kind: 'consensus',
            minimumParticipants: 1,
            maximumParticipants: 2,
            policy: { kind: 'unanimous' },
            remaining: 'drain',
            routes: {
              approved: 'second',
              rejected: 'second',
              inconclusive: 'second',
              participantFailed: 'second',
              cancelled: 'second',
            },
          },
          {
            kind: 'single',
            routes: { succeeded: 'second', failed: 'second', cancelled: 'second' },
          },
        ],
      },
      { ...sourceNodeBuilders.agent('explicit'), id: 'second' },
      { ...sourceNodeBuilders.consensus(), id: 'explicit' },
      endNode(),
    ]);

    expect(inspectPipelineSlots(source)).toEqual({
      ok: true,
      slots: [
        {
          id: 'first',
          strategies: [
            { kind: 'consensus', minimumParticipants: 1, maximumParticipants: 2 },
            { kind: 'single' },
          ],
        },
        { id: 'second', strategies: [{ kind: 'single' }] },
      ],
    });
  });

  it('returns the original source diagnostics without a partial slot list', () => {
    const source = sourceWithNodes([
      { ...sourceNodeBuilders.agent(), id: 'same' },
      { ...sourceNodeBuilders.wait(), id: 'same' },
      endNode(),
    ]);

    expect(inspectPipelineSlots(source)).toEqual({
      ok: false,
      diagnostics: [
        {
          family: 'SOURCE',
          code: 'SOURCE_NODE_ID_DUPLICATE',
          path: '/modules/0/region/nodes/2/id',
          message: 'A source node identifier is duplicated.',
        },
      ],
    });
  });

  it('returns a frozen empty descriptor list when no reachable agent exists', () => {
    const result = inspectPipelineSlots(sourceWithNodes([endNode()]));

    expect(result).toEqual({ ok: true, slots: [] });
    expect(Object.isFrozen(result)).toBe(true);
    if (!result.ok) {
      throw new TypeError('Expected a successful slot inspection.');
    }
    expect(Object.isFrozen(result.slots)).toBe(true);
  });

  it('is frozen and deterministic for equivalent source ordering', () => {
    const ordered = sourceForNode(sourceNodeBuilders.agent());
    const reordered = sourceWithNodes([endNode(), sourceNodeBuilders.agent()], 'activity');
    const first = inspectPipelineSlots(ordered);
    const second = inspectPipelineSlots(reordered);

    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new TypeError('Expected a successful slot inspection.');
    }
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.slots)).toBe(true);
    expect(Object.isFrozen(first.slots[0])).toBe(true);
    expect(Object.isFrozen(first.slots[0]?.strategies)).toBe(true);
    expect(Object.isFrozen(first.slots[0]?.strategies[0])).toBe(true);
  });

  it('reports a reusable called module agent once', () => {
    const source = sourceWithNodes([
      { ...sourceNodeBuilders.call('second'), id: 'first', module: 'shared' },
      { ...sourceNodeBuilders.call(), id: 'second', module: 'shared' },
      endNode(),
    ]);
    const shared = sourceWithNodes([
      { ...sourceNodeBuilders.agent('shared-done'), id: 'shared-agent' },
      endNode('shared-done'),
    ]).modules[0];
    if (shared === undefined) {
      throw new TypeError('Expected shared module.');
    }
    const reusable = {
      ...source,
      modules: [...source.modules, { ...shared, key: 'shared' }],
    };

    const validation = validatePipelineSource(reusable);
    if (!validation.ok) {
      throw new TypeError(JSON.stringify(validation.diagnostics));
    }
    const result: unknown = Reflect.apply(inspectPipelineSlots, undefined, [reusable]);
    expect(result).toEqual({
      ok: true,
      slots: [{ id: 'shared-agent', strategies: [{ kind: 'single' }] }],
    });
  });

  it.each(['parallel', 'repeat', 'map'] as const)(
    'discovers a reachable nested agent in a %s exactly once',
    (kind) => {
      const parent = sourceNodeBuilders[kind]('done');
      const base = sourceWithNodes([parent, endNode()]);
      const module = base.modules[0];
      const nestedId = `${kind}-agent`;
      const region =
        parent.kind === 'parallel'
          ? {
              ...parent,
              branches: [
                {
                  ...parent.branches[0],
                  input: { prompt: { kind: 'scopeInput' as const, pointer: '' as const } },
                  region: {
                    ...parent.branches[0].region,
                    inputSchema: promptSchema,
                    entry: nestedId,
                    nodes: [
                      { ...sourceNodeBuilders.agent('left-region-done'), id: nestedId },
                      endNode('left-region-done'),
                    ],
                  },
                },
                parent.branches[1],
              ],
            }
          : parent.kind === 'repeat'
            ? {
                ...parent,
                initialInput: { prompt: { kind: 'scopeInput' as const, pointer: '' as const } },
                nextInput: { prompt: { kind: 'scopeInput' as const, pointer: '' as const } },
                body: {
                  ...parent.body,
                  inputSchema: promptSchema,
                  entry: nestedId,
                  nodes: [
                    { ...sourceNodeBuilders.agent(`${parent.body.key}-done`), id: nestedId },
                    endNode(`${parent.body.key}-done`, 'value'),
                  ],
                },
              }
            : {
                ...parent,
                bodyInput: { prompt: { kind: 'scopeInput' as const, pointer: '' as const } },
                body: {
                  ...parent.body,
                  inputSchema: promptSchema,
                  entry: nestedId,
                  nodes: [
                    { ...sourceNodeBuilders.agent(`${parent.body.key}-done`), id: nestedId },
                    endNode(`${parent.body.key}-done`, 'completed'),
                  ],
                },
              };
      const source = {
        ...base,
        modules: [
          {
            ...module,
            inputSchema: promptSchema,
            region: { ...module.region, inputSchema: promptSchema, nodes: [region, endNode()] },
          },
        ],
      };
      const validation = validatePipelineSource(source);
      if (!validation.ok) {
        throw new TypeError(JSON.stringify(validation.diagnostics));
      }

      expect(Reflect.apply(inspectPipelineSlots, undefined, [source])).toEqual({
        ok: true,
        slots: [{ id: nestedId, strategies: [{ kind: 'single' }] }],
      });
    },
  );

  it('passes hostile source-envelope diagnostics through without throwing', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expect(() => {
      Reflect.apply(inspectPipelineSlots, undefined, [revoked.proxy]);
    }).not.toThrow();
    expect(Reflect.apply(inspectPipelineSlots, undefined, [revoked.proxy])).toMatchObject({
      ok: false,
    });
  });

  it('finds the later duplicate in normalized node and module order', () => {
    const unsorted = sourceWithNodes([
      { ...sourceNodeBuilders.wait('done'), id: 'z' },
      { ...sourceNodeBuilders.wait('done'), id: 'a' },
      { ...sourceNodeBuilders.wait('done'), id: 'a' },
      endNode(),
    ]);
    const firstModule = sourceWithNodes([
      { ...sourceNodeBuilders.wait('a-done'), id: 'duplicate' },
      endNode('a-done'),
    ]).modules[0];
    const secondModule = sourceWithNodes([
      { ...sourceNodeBuilders.wait('z-done'), id: 'duplicate' },
      endNode('z-done'),
    ]).modules[0];
    if (firstModule === undefined || secondModule === undefined) {
      throw new TypeError('Expected source modules.');
    }
    const crossModule = {
      ...unsorted,
      entryModule: 'a',
      modules: [
        { ...secondModule, key: 'z' },
        { ...firstModule, key: 'a' },
      ],
    };

    expect(inspectPipelineSlots(unsorted)).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'SOURCE_NODE_ID_DUPLICATE',
          path: '/modules/0/region/nodes/1/id',
        }),
      ],
    });
    expect(validatePipelineSource(crossModule)).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'SOURCE_NODE_ID_DUPLICATE',
          path: '/modules/1/region/nodes/0/id',
        }),
      ],
    });
  });

  it.each(['parallel', 'repeat', 'map'] as const)(
    'detects a duplicate between a %s parent and nested region after normalization',
    (kind) => {
      const parent = sourceNodeBuilders[kind]('done');
      const source = sourceWithNodes([{ ...parent, id: 'shared' }, endNode()]);
      const node = source.modules[0]?.region.nodes[0];
      if (node === undefined || node.kind !== kind) {
        throw new TypeError('Expected the requested parent node.');
      }
      const nested =
        node.kind === 'parallel'
          ? {
              ...source,
              modules: [
                {
                  ...source.modules[0],
                  region: {
                    ...source.modules[0].region,
                    nodes: [
                      {
                        ...node,
                        branches: [
                          {
                            ...node.branches[0],
                            region: {
                              ...node.branches[0].region,
                              nodes: [
                                { ...sourceNodeBuilders.wait('left-region-done'), id: 'shared' },
                                endNode('left-region-done'),
                              ],
                            },
                          },
                          node.branches[1],
                        ],
                      },
                      source.modules[0].region.nodes[1],
                    ],
                  },
                },
              ],
            }
          : {
              ...source,
              modules: [
                {
                  ...source.modules[0],
                  region: {
                    ...source.modules[0].region,
                    nodes: [
                      {
                        ...node,
                        body: {
                          ...node.body,
                          nodes: [
                            { ...sourceNodeBuilders.wait(`${node.body.key}-done`), id: 'shared' },
                            endNode(`${node.body.key}-done`, node.body.exits[0]?.outcome ?? 'ok'),
                          ],
                        },
                      },
                      source.modules[0].region.nodes[1],
                    ],
                  },
                },
              ],
            };

      expect(validatePipelineSource(nested)).toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({ code: 'SOURCE_NODE_ID_DUPLICATE' })],
      });
    },
  );
});
