import { describe, expect, test } from 'vitest';

import {
  buildGraphKernel,
  collectBarrierRegionOwnership,
  reachableNodeOffsets,
  reverseReachableNodeOffsets,
  topologicalOrder,
} from '../../../src/graph/index.js';
import type { GraphOperationKind, GraphOperationSink } from '../../../src/graph/index.js';

const kernel = (nodeKeys: readonly string[], edges: readonly { from: string; to: string }[]) => {
  const built = buildGraphKernel({ nodeKeys, edges });
  if (!built.ok) {
    throw new Error(`Unexpected graph kernel failure: ${built.reason}`);
  }
  return built.kernel;
};

const counter = (): {
  readonly sink: GraphOperationSink;
  readonly values: Record<GraphOperationKind, number>;
} => {
  const values: Record<GraphOperationKind, number> = {
    node: 0,
    edge: 0,
    readyWord: 0,
    bitsetWord: 0,
    region: 0,
  };
  return {
    values,
    sink: {
      add(kind, count) {
        if (!Object.hasOwn(values, kind) || !Number.isSafeInteger(count) || count < 0) {
          throw new Error('Counter must receive a non-negative safe integer.');
        }
        values[kind] += count;
      },
    },
  };
};

const totalOperations = (values: Record<GraphOperationKind, number>): number =>
  Object.values(values).reduce((total, value) => total + value, 0);

const referenceReachable = (
  nodeCount: number,
  edges: readonly { readonly from: string; readonly to: string }[],
  starts: readonly number[],
  reverse = false,
): readonly boolean[] => {
  const keys = Array.from({ length: nodeCount }, (_, index) => `n${index}`);
  const reached = new Set<number>();
  const pending = [...starts];
  while (pending.length > 0) {
    const offset = pending.pop();
    if (offset === undefined || reached.has(offset)) {
      continue;
    }
    reached.add(offset);
    for (const edge of edges) {
      const from = keys.indexOf(edge.from);
      const to = keys.indexOf(edge.to);
      if (reverse ? to === offset : from === offset) {
        pending.push(reverse ? from : to);
      }
    }
  }
  return Array.from({ length: nodeCount }, (_, index) => reached.has(index));
};

const referenceTopology = (
  keys: readonly string[],
  edges: readonly { readonly from: string; readonly to: string }[],
): readonly number[] | null => {
  const indegree = keys.map((key) => edges.filter((edge) => edge.to === key).length);
  const ready = keys
    .flatMap((_key, index) => (indegree[index] === 0 ? [index] : []))
    .sort((a, b) => a - b);
  const order: number[] = [];
  while (ready.length > 0) {
    const offset = ready.shift();
    if (offset === undefined) {
      break;
    }
    order.push(offset);
    for (const edge of edges.filter((candidate) => candidate.from === keys[offset])) {
      const target = keys.indexOf(edge.to);
      indegree[target] = (indegree[target] ?? 0) - 1;
      if (indegree[target] === 0) {
        ready.push(target);
      }
    }
    ready.sort((a, b) => a - b);
  }
  return order.length === keys.length ? order : null;
};

describe('graph kernel algorithms', () => {
  test('matches independent exhaustive small topology and reachability references', () => {
    const keys = ['n0', 'n1', 'n2'];
    const possible = keys.flatMap((from) =>
      keys.filter((to) => to !== from).map((to) => ({ from, to })),
    );
    for (let mask = 0; mask < 1 << possible.length; mask += 1) {
      const edges = possible.filter((_edge, index) => (mask & (1 << index)) !== 0);
      const graph = kernel(keys, edges);
      expect(topologicalOrder(graph)).toEqual(referenceTopology(keys, edges));
      for (let start = 0; start < keys.length; start += 1) {
        expect(reachableNodeOffsets(graph, [start])).toEqual(
          referenceReachable(keys.length, edges, [start]),
        );
        expect(reverseReachableNodeOffsets(graph, [start])).toEqual(
          referenceReachable(keys.length, edges, [start], true),
        );
      }
    }
  });
  test('uses canonical offsets for topological ties and detects cycles', () => {
    expect(
      topologicalOrder(
        kernel(
          ['a', 'b', 'c', 'd'],
          [
            { from: 'a', to: 'c' },
            { from: 'b', to: 'c' },
            { from: 'c', to: 'd' },
          ],
        ),
      ),
    ).toEqual([0, 1, 2, 3]);
    expect(
      topologicalOrder(
        kernel(
          ['a', 'b'],
          [
            { from: 'a', to: 'b' },
            { from: 'b', to: 'a' },
          ],
        ),
      ),
    ).toBeNull();
  });

  test('derives forward, reverse and barrier-bounded offset reachability', () => {
    const graph = kernel(
      ['a', 'b', 'c', 'd'],
      [
        { from: 'a', to: 'c' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
      ],
    );
    expect(reachableNodeOffsets(graph, [0])).toEqual([true, false, true, true]);
    expect(reverseReachableNodeOffsets(graph, [3])).toEqual([true, true, true, true]);
    expect(
      collectBarrierRegionOwnership(graph, topologicalOrder(graph), [
        { barrierNodeOffset: 3, branches: [{ entryNodeOffset: 0, exitNodeOffset: 2 }] },
      ])[0]?.membersByBranch,
    ).toEqual([[0, 2]]);
  });

  test('keeps canonical adjacency and every kernel-owned array immutable', () => {
    const graph = kernel(
      ['a', 'b', 'c'],
      [
        { from: 'a', to: 'c' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    );
    expect(graph.outgoingEdgeOffsets).toEqual([[0, 1], [2], []]);
    expect(Object.isFrozen(graph.nodeKeys)).toBe(true);
    expect(Object.isFrozen(graph.outgoingEdgeOffsets)).toBe(true);
    expect(Object.isFrozen(graph.outgoingEdgeOffsets[0])).toBe(true);
    expect(graph.nodeOffset('b')).toBe(1);
    expect(graph.nodeOffset('missing')).toBeUndefined();
  });

  test('rejects generic malformed kernel inputs without normalizing them', () => {
    expect(buildGraphKernel({ nodeKeys: ['b', 'a'], edges: [] })).toMatchObject({
      ok: false,
      reason: 'node-order',
      offset: 1,
    });
    expect(buildGraphKernel({ nodeKeys: ['a'], edges: [{ from: 'a', to: 'b' }] })).toMatchObject({
      ok: false,
      reason: 'foreign-edge',
      offset: 0,
    });
  });

  test('validates counter increments', () => {
    const operations = counter();
    expect(() =>
      operations.sink.add(
        // @ts-expect-error Exercise the runtime unknown-kind guard.
        'unknown',
        1,
      ),
    ).toThrow('Counter must receive a non-negative safe integer.');
    expect(() => operations.sink.add('node', -1)).toThrow(
      'Counter must receive a non-negative safe integer.',
    );
    expect(() => operations.sink.add('edge', Number.NaN)).toThrow(
      'Counter must receive a non-negative safe integer.',
    );
  });

  test('uses an eight-word ready set across signed word boundaries', () => {
    const keys = Array.from({ length: 256 }, (_, index) => `n${String(index).padStart(3, '0')}`);
    const graph = kernel(keys, []);
    const operations = counter();
    expect(topologicalOrder(graph, operations.sink)).toEqual(
      Array.from({ length: 256 }, (_, index) => index),
    );
    expect(operations.values.readyWord).toBeLessThanOrEqual(8 * 256 + 8 + 256 * 2);
    expect(operations.values.bitsetWord).toBe(0);
  });

  test.each([0, 31, 32, 63, 64, 127, 128, 255])(
    'preserves canonical topology across %i-node bitset widths',
    (size) => {
      const keys = Array.from({ length: size }, (_, index) => `n${String(index).padStart(3, '0')}`);
      const edges = keys.slice(1).map((to, index) => ({ from: keys[index]!, to }));
      expect(topologicalOrder(kernel(keys, edges))).toEqual(
        Array.from({ length: size }, (_, index) => index),
      );
    },
  );

  test('charges exact visited and fallback member-enumeration mask primitives', () => {
    const singleton = kernel(['a'], []);
    const visited = counter();
    expect(reachableNodeOffsets(singleton, [0, 0], visited.sink)).toEqual([true]);
    expect(visited.values.bitsetWord).toBe(3);

    const cyclic = kernel(
      ['a', 'b'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    );
    const enumerated = counter();
    expect(
      collectBarrierRegionOwnership(
        cyclic,
        null,
        [{ barrierNodeOffset: 1, branches: [{ entryNodeOffset: 0, exitNodeOffset: 0 }] }],
        enumerated.sink,
      )[0]?.membersByBranch,
    ).toEqual([[0]]);
    expect(enumerated.values.bitsetWord).toBe(8);
  });

  test('charges visited masks separately from ready words for forward and reverse reachability', () => {
    const graph = kernel(
      ['a', 'b', 'c'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    );
    const forward = counter();
    const reverse = counter();
    expect(reachableNodeOffsets(graph, [0], forward.sink)).toEqual([true, true, true]);
    expect(reverseReachableNodeOffsets(graph, [2], reverse.sink)).toEqual([true, true, true]);
    expect(forward.values.bitsetWord).toBeGreaterThan(0);
    expect(reverse.values.bitsetWord).toBeGreaterThan(0);
    expect(forward.values.readyWord).toBe(0);
    expect(reverse.values.readyWord).toBe(0);
  });

  test('uses shared acyclic rows and bounded cyclic fallback across multiple queries', () => {
    const dag = kernel(
      ['a', 'b', 'c', 'd', 'e'],
      [
        { from: 'a', to: 'c' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
        { from: 'd', to: 'e' },
      ],
    );
    const valid = counter();
    const queries = Array.from({ length: 2 }, () => ({
      barrierNodeOffset: 4,
      branches: [
        { entryNodeOffset: 0, exitNodeOffset: 3 },
        { entryNodeOffset: 1, exitNodeOffset: 3 },
      ],
    }));
    expect(
      collectBarrierRegionOwnership(dag, topologicalOrder(dag), queries, valid.sink),
    ).toHaveLength(2);
    expect(valid.values.bitsetWord).toBeGreaterThan(0);

    const cyclic = kernel(
      ['a', 'b'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    );
    const malformed = counter();
    expect(
      collectBarrierRegionOwnership(
        cyclic,
        null,
        Array.from({ length: 2 }, () => ({
          barrierNodeOffset: 1,
          branches: Array.from({ length: 32 }, () => ({ entryNodeOffset: 0, exitNodeOffset: 0 })),
        })),
        malformed.sink,
      ),
    ).toHaveLength(2);
    expect(malformed.values.edge).toBeGreaterThan(0);
    expect(malformed.values.region).toBeGreaterThanOrEqual(64);
  });

  test('stays within the normative valid and malformed operation envelopes', () => {
    const validKeys = Array.from(
      { length: 64 },
      (_, index) => `n${String(index).padStart(3, '0')}`,
    );
    const validEdges = validKeys.slice(1).map((to, index) => ({ from: validKeys[index]!, to }));
    const validCount = counter();
    const validBuild = buildGraphKernel(
      { nodeKeys: validKeys, edges: validEdges },
      validCount.sink,
    );
    if (!validBuild.ok) {
      throw new Error('Expected valid graph kernel.');
    }
    const validTopology = topologicalOrder(validBuild.kernel, validCount.sink);
    reachableNodeOffsets(validBuild.kernel, [0], validCount.sink);
    reverseReachableNodeOffsets(validBuild.kernel, [63], validCount.sink);
    collectBarrierRegionOwnership(
      validBuild.kernel,
      validTopology,
      [{ barrierNodeOffset: 63, branches: [{ entryNodeOffset: 0, exitNodeOffset: 62 }] }],
      validCount.sink,
    );
    const validV = validKeys.length;
    const validE = validEdges.length;
    const validR = 1 + 63;
    expect(totalOperations(validCount.values)).toBeLessThanOrEqual(
      308 * validV + 48 * validE + 32 * validR + 150,
    );

    const malformedCount = counter();
    const malformedBuild = buildGraphKernel(
      {
        nodeKeys: ['a', 'b'],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      },
      malformedCount.sink,
    );
    if (!malformedBuild.ok) {
      throw new Error('Expected cyclic graph kernel construction to succeed.');
    }
    const malformedQueries = Array.from({ length: 2 }, () => ({
      barrierNodeOffset: 1,
      branches: Array.from({ length: 32 }, () => ({ entryNodeOffset: 0, exitNodeOffset: 0 })),
    }));
    collectBarrierRegionOwnership(
      malformedBuild.kernel,
      null,
      malformedQueries,
      malformedCount.sink,
    );
    const malformedBtotal = malformedQueries.reduce(
      (total, query) => total + query.branches.length,
      0,
    );
    const malformedR = malformedBtotal * 2;
    expect(totalOperations(malformedCount.values)).toBeLessThanOrEqual(
      308 * 2 + 48 * 2 + 32 * malformedR + 150 + malformedBtotal * (6 * 2 + 2 * 2 + 2),
    );
  });

  test('rejects an aggregate 8193rd branch query before fallback traversal', () => {
    const graph = kernel(
      Array.from({ length: 256 }, (_, index) => `n${String(index).padStart(3, '0')}`),
      [
        { from: 'n000', to: 'n001' },
        { from: 'n001', to: 'n000' },
      ],
    );
    const operations = counter();
    const queries = Array.from({ length: 256 }, () => ({
      barrierNodeOffset: 1,
      branches: Array.from({ length: 32 }, () => ({ entryNodeOffset: 0, exitNodeOffset: 0 })),
    }));
    queries[255] = {
      barrierNodeOffset: 1,
      branches: Array.from({ length: 33 }, () => ({ entryNodeOffset: 0, exitNodeOffset: 0 })),
    };
    expect(collectBarrierRegionOwnership(graph, null, queries, operations.sink)).toEqual([]);
    expect(totalOperations(operations.values)).toBe(0);
  });

  test('accepts the bounded 8192 branch-query fallback volume', () => {
    const graph = kernel(
      Array.from({ length: 256 }, (_, index) => `n${String(index).padStart(3, '0')}`),
      [
        { from: 'n000', to: 'n001' },
        { from: 'n001', to: 'n000' },
      ],
    );
    const operations = counter();
    const queries = Array.from({ length: 256 }, () => ({
      barrierNodeOffset: 1,
      branches: Array.from({ length: 32 }, () => ({ entryNodeOffset: 0, exitNodeOffset: 0 })),
    }));
    expect(collectBarrierRegionOwnership(graph, null, queries, operations.sink)).toHaveLength(256);
    expect(totalOperations(operations.values)).toBeLessThanOrEqual(
      308 * 256 + 48 * 2 + 32 * (8192 * 2) + 150 + 8192 * (6 * 256 + 2 * 2 + 2),
    );
  });
});
