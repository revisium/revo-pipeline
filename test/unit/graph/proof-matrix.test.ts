import { describe, expect, test } from 'vitest';

import {
  buildGraphKernel,
  collectBarrierRegionOwnership,
  reachableNodeOffsets,
  reverseReachableNodeOffsets,
  topologicalOrder,
} from '../../../src/graph/index.js';
import type {
  BarrierRegionOwnership,
  BarrierRegionQuery,
  GraphKernel,
  GraphOperationKind,
  GraphOperationSink,
} from '../../../src/graph/index.js';

type Edge = { readonly from: string; readonly to: string };
type Counts = Record<GraphOperationKind, number>;

const emptyCounts = (): Counts => ({
  node: 0,
  edge: 0,
  readyWord: 0,
  bitsetWord: 0,
  region: 0,
});

const recordingSink = (): { readonly counts: Counts; readonly sink: GraphOperationSink } => {
  const counts = emptyCounts();
  return {
    counts,
    sink: {
      add(kind, count) {
        counts[kind] += count;
      },
    },
  };
};

const build = (nodeKeys: readonly string[], edges: readonly Edge[]): GraphKernel => {
  const result = buildGraphKernel({ nodeKeys, edges });
  if (!result.ok) {
    throw new Error(`Unexpected kernel failure: ${result.reason}`);
  }
  return result.kernel;
};

const total = (counts: Counts): number =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

const withoutCount = (counts: Counts, kind: GraphOperationKind, count: number): Counts => ({
  ...counts,
  [kind]: counts[kind] - count,
});

const keys = (size: number): readonly string[] =>
  Array.from({ length: size }, (_, offset) => `n${String(offset).padStart(3, '0')}`);

const chainEdges = (nodeKeys: readonly string[]): readonly Edge[] =>
  nodeKeys.slice(1).map((to, offset) => ({ from: nodeKeys[offset]!, to }));

const adjacency = (
  nodeCount: number,
  edges: readonly { readonly from: number; readonly to: number }[],
  reverse: boolean,
): readonly (readonly number[])[] => {
  const result = Array.from({ length: nodeCount }, () => [] as number[]);
  for (const edge of edges) {
    result[reverse ? edge.to : edge.from]?.push(reverse ? edge.from : edge.to);
  }
  return result;
};

const referenceReach = (
  nodeCount: number,
  edges: readonly { readonly from: number; readonly to: number }[],
  starts: readonly number[],
  reverse = false,
  barrier = -1,
): readonly boolean[] => {
  const neighbors = adjacency(nodeCount, edges, reverse);
  const reached = Array.from({ length: nodeCount }, () => false);
  const pending = [...starts];
  while (pending.length > 0) {
    const offset = pending.pop();
    if (
      offset === undefined ||
      offset < 0 ||
      offset >= nodeCount ||
      offset === barrier ||
      reached[offset]
    ) {
      continue;
    }
    reached[offset] = true;
    pending.push(...(neighbors[offset] ?? []));
  }
  return reached;
};

const referenceTopology = (
  nodeCount: number,
  edges: readonly { readonly from: number; readonly to: number }[],
): readonly number[] | null => {
  const outgoing = adjacency(nodeCount, edges, false);
  const indegree = Array.from({ length: nodeCount }, () => 0);
  for (const edge of edges) {
    indegree[edge.to] = (indegree[edge.to] ?? 0) + 1;
  }
  const emitted = Array.from({ length: nodeCount }, () => false);
  const order: number[] = [];
  while (order.length < nodeCount) {
    const next = indegree.findIndex((degree, offset) => degree === 0 && !emitted[offset]);
    if (next < 0) {
      return null;
    }
    emitted[next] = true;
    order.push(next);
    for (const target of outgoing[next] ?? []) {
      indegree[target] = (indegree[target] ?? 0) - 1;
    }
  }
  return order;
};

const referenceOwnership = (
  nodeCount: number,
  edges: readonly { readonly from: number; readonly to: number }[],
  queries: readonly BarrierRegionQuery[],
): readonly BarrierRegionOwnership[] => {
  const priorOwners = new Set<number>();
  return queries.map((query) => {
    const localOwners = new Set<number>();
    const overlapping = new Set<number>();
    const foreign = new Set<number>();
    const membersByBranch = query.branches.map((branch) => {
      const forward = referenceReach(
        nodeCount,
        edges,
        [branch.entryNodeOffset],
        false,
        query.barrierNodeOffset,
      );
      const reverse = referenceReach(
        nodeCount,
        edges,
        [branch.exitNodeOffset],
        true,
        query.barrierNodeOffset,
      );
      const members = forward.flatMap((reached, offset) =>
        reached && reverse[offset] && offset !== query.barrierNodeOffset ? [offset] : [],
      );
      for (const member of members) {
        if (localOwners.has(member)) {
          overlapping.add(member);
        }
        if (priorOwners.has(member)) {
          foreign.add(member);
        }
        localOwners.add(member);
      }
      return members;
    });
    for (const member of localOwners) {
      priorOwners.add(member);
    }
    return {
      membersByBranch,
      overlappingNodeOffsets: [...overlapping].sort((left, right) => left - right),
      foreignRegionNodeOffsets: [...foreign].sort((left, right) => left - right),
    };
  });
};

const seeded = (initial: number): (() => number) => {
  let state = initial >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const numericEdges = (
  nodeKeys: readonly string[],
  edges: readonly Edge[],
): readonly { readonly from: number; readonly to: number }[] =>
  edges.map((edge) => ({
    from: nodeKeys.indexOf(edge.from),
    to: nodeKeys.indexOf(edge.to),
  }));

const reachCounterOracle = (
  nodeCount: number,
  edges: readonly { readonly from: number; readonly to: number }[],
  starts: readonly number[],
  reverse: boolean,
  barrier = -1,
): Counts => {
  const counts = emptyCounts();
  const neighbors = adjacency(nodeCount, edges, reverse);
  const reached = Array.from({ length: nodeCount }, () => false);
  const pending = [...starts];
  while (pending.length > 0) {
    const offset = pending.pop();
    if (offset === undefined || offset < 0 || offset >= nodeCount || offset === barrier) {
      continue;
    }
    counts.bitsetWord += 1;
    if (reached[offset]) {
      continue;
    }
    counts.bitsetWord += 1;
    reached[offset] = true;
    counts.node += 1;
    for (const target of neighbors[offset] ?? []) {
      counts.edge += 1;
      pending.push(target);
    }
  }
  counts.node += nodeCount;
  return counts;
};

const regionCounterOracle = (
  nodeCount: number,
  edges: readonly { readonly from: number; readonly to: number }[],
  topology: readonly number[] | null,
  queries: readonly BarrierRegionQuery[],
): Counts => {
  const counts = emptyCounts();
  const words = Math.ceil(nodeCount / 32);
  const ownership = referenceOwnership(nodeCount, edges, queries);
  const positions =
    topology === null
      ? undefined
      : Object.fromEntries(topology.map((offset, position) => [offset, position]));
  if (topology !== null) {
    counts.node += 2 * nodeCount;
    counts.edge += 3 * edges.length;
    counts.bitsetWord += 2 * nodeCount + 2 * words * edges.length;
  }
  for (let queryOffset = 0; queryOffset < queries.length; queryOffset += 1) {
    const query = queries[queryOffset]!;
    const queryOwnership = ownership[queryOffset]!;
    const barrierPosition = positions?.[query.barrierNodeOffset];
    const sharedSafe =
      barrierPosition !== undefined &&
      query.branches.every(
        (branch) =>
          (positions?.[branch.entryNodeOffset] ?? Number.POSITIVE_INFINITY) < barrierPosition &&
          (positions?.[branch.exitNodeOffset] ?? Number.POSITIVE_INFINITY) < barrierPosition,
      );
    counts.region +=
      queryOwnership.overlappingNodeOffsets.length + queryOwnership.foreignRegionNodeOffsets.length;
    for (let branchOffset = 0; branchOffset < query.branches.length; branchOffset += 1) {
      const branch = query.branches[branchOffset]!;
      const members = queryOwnership.membersByBranch[branchOffset] ?? [];
      counts.region += 1 + members.length;
      counts.bitsetWord += words + words + 2 * members.length;
      if (!sharedSafe) {
        const forward = reachCounterOracle(
          nodeCount,
          edges,
          [branch.entryNodeOffset],
          false,
          query.barrierNodeOffset,
        );
        const reverse = reachCounterOracle(
          nodeCount,
          edges,
          [branch.exitNodeOffset],
          true,
          query.barrierNodeOffset,
        );
        counts.node += forward.node + reverse.node - 2 * nodeCount;
        counts.edge += forward.edge + reverse.edge;
        counts.bitsetWord += forward.bitsetWord + reverse.bitsetWord;
      }
    }
  }
  return counts;
};

const topologyValidationCounterOracle = (
  nodeCount: number,
  edges: readonly { readonly from: number; readonly to: number }[],
  claimedOrder: readonly number[],
): Counts => {
  const counts = emptyCounts();
  if (claimedOrder.length !== nodeCount) {
    return counts;
  }
  const positions = Array.from({ length: nodeCount }, () => -1);
  for (let position = 0; position < claimedOrder.length; position += 1) {
    counts.node += 1;
    const offset = claimedOrder[position];
    if (
      offset === undefined ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= nodeCount ||
      positions[offset] !== -1
    ) {
      return counts;
    }
    positions[offset] = position;
  }
  for (const edge of edges) {
    counts.edge += 1;
    if ((positions[edge.from] ?? -1) >= (positions[edge.to] ?? -1)) {
      return counts;
    }
  }
  return counts;
};

const addCounts = (left: Counts, right: Counts): Counts => ({
  node: left.node + right.node,
  edge: left.edge + right.edge,
  readyWord: left.readyWord + right.readyWord,
  bitsetWord: left.bitsetWord + right.bitsetWord,
  region: left.region + right.region,
});

const query = (
  barrierNodeOffset: number,
  branches: readonly (readonly [number, number])[],
): BarrierRegionQuery => ({
  barrierNodeOffset,
  branches: branches.map(([entryNodeOffset, exitNodeOffset]) => ({
    entryNodeOffset,
    exitNodeOffset,
  })),
});

describe('graph kernel proof matrix', () => {
  test('matches seeded independent references for DAG, cyclic, and disconnected ownership', () => {
    const random = seeded(0x5eed_2026);
    for (let sample = 0; sample < 120; sample += 1) {
      const nodeCount = 2 + Math.floor(random() * 9);
      const nodeKeys = keys(nodeCount);
      const edges: Edge[] = [];
      for (let from = 0; from < nodeCount; from += 1) {
        for (let to = 0; to < nodeCount; to += 1) {
          if (from !== to && random() < 0.16) {
            edges.push({ from: nodeKeys[from]!, to: nodeKeys[to]! });
          }
        }
      }
      const graph = build(nodeKeys, edges);
      const offsets = numericEdges(nodeKeys, edges);
      const expectedTopology = referenceTopology(nodeCount, offsets);
      expect(topologicalOrder(graph)).toEqual(expectedTopology);
      for (let start = 0; start < nodeCount; start += 1) {
        expect(reachableNodeOffsets(graph, [start])).toEqual(
          referenceReach(nodeCount, offsets, [start]),
        );
        expect(reverseReachableNodeOffsets(graph, [start])).toEqual(
          referenceReach(nodeCount, offsets, [start], true),
        );
      }
      const queries = Array.from({ length: Math.min(3, nodeCount) }, () => {
        const barrier =
          expectedTopology === null
            ? Math.floor(random() * nodeCount)
            : expectedTopology[nodeCount - 1]!;
        const eligible =
          expectedTopology === null
            ? Array.from({ length: nodeCount }, (_, offset) => offset)
            : expectedTopology.slice(0, -1);
        return query(
          barrier,
          Array.from({ length: 1 + Math.floor(random() * 3) }, () => [
            eligible[Math.floor(random() * eligible.length)] ?? barrier,
            eligible[Math.floor(random() * eligible.length)] ?? barrier,
          ]),
        );
      });
      expect(collectBarrierRegionOwnership(graph, expectedTopology, queries)).toEqual(
        referenceOwnership(nodeCount, offsets, queries),
      );
    }
  });

  test('keeps shared DAG rows barrier-equivalent to bounded traversal', () => {
    const nodeKeys = ['a', 'barrier', 'exit', 'x'];
    const edges = [
      { from: 'a', to: 'barrier' },
      { from: 'barrier', to: 'x' },
      { from: 'x', to: 'exit' },
    ];
    const offsets = numericEdges(nodeKeys, edges);
    const queries = [query(1, [[0, 2]]), query(2, [[0, 3]])];
    const graph = build(nodeKeys, edges);
    const topology = topologicalOrder(graph);
    const operations = recordingSink();
    const expected = referenceOwnership(nodeKeys.length, offsets, queries);
    expect(expected[0]?.membersByBranch).toEqual([[]]);
    expect(collectBarrierRegionOwnership(graph, topology, queries, operations.sink)).toEqual(
      expected,
    );
    expect(operations.counts).toEqual(
      regionCounterOracle(nodeKeys.length, offsets, topology, queries),
    );
    expect(operations.counts.node).toBeGreaterThan(nodeKeys.length);

    const permutedGraph = build(nodeKeys, [...edges].reverse());
    expect(
      collectBarrierRegionOwnership(permutedGraph, topologicalOrder(permutedGraph), queries),
    ).toEqual(expected);
  });

  test.each([
    ['edge-order violation', [1, 0, 2]],
    ['duplicate offset', [0, 0, 2]],
    ['negative offset', [-1, 1, 2]],
    ['out-of-range offset', [0, 1, 3]],
    ['non-integer offset', [0, 1.5, 2]],
    ['non-finite offset', [0, Number.NaN, 2]],
  ])('routes an invalid claimed topology through bounded fallback: %s', (_name, claimedOrder) => {
    const nodeKeys = ['a', 'b', 'c'];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ];
    const graph = build(nodeKeys, edges);
    const offsets = numericEdges(nodeKeys, edges);
    const queries = [query(2, [[0, 1]])];
    const operations = recordingSink();
    const expected = referenceOwnership(nodeKeys.length, offsets, queries);
    expect(collectBarrierRegionOwnership(graph, claimedOrder, queries, operations.sink)).toEqual(
      expected,
    );
    expect(operations.counts).toEqual(
      addCounts(
        topologyValidationCounterOracle(nodeKeys.length, offsets, claimedOrder),
        regionCounterOracle(nodeKeys.length, offsets, null, queries),
      ),
    );
    expect(total(operations.counts)).toBeLessThanOrEqual(
      308 * 3 + 48 * 2 + 32 * operations.counts.region + 150 + (6 * 3 + 2 * 2 + 2),
    );
  });

  test.each([0, 1, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256])(
    'proves topology and reach counters across the V=%i word boundary',
    (nodeCount) => {
      const nodeKeys = keys(nodeCount);
      const edges = chainEdges(nodeKeys);
      const offsets = numericEdges(nodeKeys, edges);
      const graph = build(nodeKeys, edges);

      const topologyCounts = recordingSink();
      expect(topologicalOrder(graph, topologyCounts.sink)).toEqual(
        Array.from({ length: nodeCount }, (_, offset) => offset),
      );
      expect(topologyCounts.counts.node).toBeLessThanOrEqual(3 * nodeCount + 1);
      expect(topologyCounts.counts.edge).toBe(edges.length);
      expect(topologyCounts.counts.readyWord).toBeLessThanOrEqual(8 * nodeCount + 8);
      expect(topologyCounts.counts.bitsetWord).toBe(0);
      expect(topologyCounts.counts.region).toBe(0);

      const reachCounts = recordingSink();
      const starts = nodeCount === 0 ? [] : [0, 0];
      reachableNodeOffsets(graph, starts, reachCounts.sink);
      expect(reachCounts.counts).toEqual(reachCounterOracle(nodeCount, offsets, starts, false));
      expect(reachCounts.counts.bitsetWord).toBeLessThanOrEqual(
        2 * nodeCount + 2 * starts.length + 2,
      );
    },
  );

  test('independently detects omission of every mandatory counter site', () => {
    const nodeKeys = keys(65);
    const edges: readonly Edge[] = [
      ...chainEdges(nodeKeys),
      { from: 'n000', to: 'n032' },
      { from: 'n000', to: 'n064' },
      { from: 'n032', to: 'n064' },
    ];
    const graph = build(nodeKeys, edges);
    const offsets = numericEdges(nodeKeys, edges);
    const topology = topologicalOrder(graph);
    const queries = [
      query(64, [
        [0, 63],
        [32, 63],
      ]),
      query(64, [[0, 32]]),
    ];

    const forward = recordingSink();
    reachableNodeOffsets(graph, [0, 0], forward.sink);
    expect(forward.counts).toEqual(reachCounterOracle(65, offsets, [0, 0], false));

    const reverse = recordingSink();
    reverseReachableNodeOffsets(graph, [64, 64], reverse.sink);
    expect(reverse.counts).toEqual(reachCounterOracle(65, offsets, [64, 64], true));

    const regions = recordingSink();
    collectBarrierRegionOwnership(graph, topology, queries, regions.sink);
    const expected = regionCounterOracle(65, offsets, topology, queries);
    expect(regions.counts).toEqual(expected);

    const forwardExpected = reachCounterOracle(65, offsets, [0, 0], false);
    const reverseExpected = reachCounterOracle(65, offsets, [64, 64], true);
    const omissionMutants = [
      ['forward visited test', forward.counts, forwardExpected, 'bitsetWord', 1],
      ['forward visited set', forward.counts, forwardExpected, 'bitsetWord', 1],
      ['reverse visited test', reverse.counts, reverseExpected, 'bitsetWord', 1],
      ['reverse visited set', reverse.counts, reverseExpected, 'bitsetWord', 1],
      ['topology node validation', regions.counts, expected, 'node', 65],
      ['topology edge validation', regions.counts, expected, 'edge', edges.length],
      ['forward row OR', regions.counts, expected, 'bitsetWord', edges.length * 3],
      ['reverse row OR', regions.counts, expected, 'bitsetWord', edges.length * 3],
      ['branch intersection', regions.counts, expected, 'bitsetWord', 3 * 3],
      ['membership-word scan', regions.counts, expected, 'bitsetWord', 3 * 3],
      ['member occurrence', regions.counts, expected, 'region', expected.region - 3],
      ['overlap conflict occurrence', regions.counts, expected, 'region', 32],
      ['foreign conflict occurrence', regions.counts, expected, 'region', 33],
    ] as const;
    for (const [_site, observed, reference, kind, omitted] of omissionMutants) {
      expect(omitted).toBeGreaterThan(0);
      expect(observed).not.toEqual(withoutCount(reference, kind, omitted));
    }
  });

  test.each([
    [2, 1],
    [33, 2],
    [97, 4],
    [225, 8],
  ])(
    'charges exact shared row, intersection, ownership, and enumeration work at V=%i',
    (nodeCount, wordCount) => {
      const nodeKeys = keys(nodeCount);
      const edges = chainEdges(nodeKeys);
      const graph = build(nodeKeys, edges);
      const offsets = numericEdges(nodeKeys, edges);
      const topology = topologicalOrder(graph);
      const queries = [query(nodeCount - 1, [[0, Math.max(0, nodeCount - 2)]])];
      const actual = recordingSink();
      collectBarrierRegionOwnership(graph, topology, queries, actual.sink);
      const expected = regionCounterOracle(nodeCount, offsets, topology, queries);
      expect(Math.ceil(nodeCount / 32)).toBe(wordCount);
      expect(actual.counts).toEqual(expected);
      expect(actual.counts.edge).toBe(3 * edges.length);
      expect(actual.counts.bitsetWord).toBe(
        2 * nodeCount + 2 * wordCount * edges.length + wordCount + wordCount + 2 * (nodeCount - 1),
      );
      expect(actual.counts.readyWord).toBe(0);
    },
  );

  test.each([0, 1, 31, 32])('accepts one region query with %i branches', (branchCount) => {
    const graph = build(keys(32), []);
    const operations = recordingSink();
    expect(
      collectBarrierRegionOwnership(
        graph,
        topologicalOrder(graph),
        [
          query(
            31,
            Array.from({ length: branchCount }, () => [0, 0]),
          ),
        ],
        operations.sink,
      ),
    ).toHaveLength(1);
  });

  test('rejects branch/query precheck overflow before counted graph work', () => {
    const graph = build(keys(256), []);
    const cases: readonly (readonly BarrierRegionQuery[])[] = [
      [
        query(
          255,
          Array.from({ length: 33 }, () => [0, 0]),
        ),
      ],
      Array.from({ length: 257 }, () => query(255, [])),
      [query(-1, [])],
      [query(255, [[-1, 0]])],
    ];
    for (const queries of cases) {
      const operations = recordingSink();
      expect(
        collectBarrierRegionOwnership(graph, topologicalOrder(graph), queries, operations.sink),
      ).toEqual([]);
      expect(operations.counts).toEqual(emptyCounts());
    }
  });

  test.each([
    [31, [31]],
    [32, [32]],
    [33, [1, 32]],
    [8191, [...Array.from({ length: 255 }, () => 32), 31]],
    [8192, Array.from({ length: 256 }, () => 32)],
  ])('accepts independently summed Btotal=%i', (branchTotal, branchCounts) => {
    const graph = build(keys(256), []);
    const queries = branchCounts.map((branchCount) =>
      query(
        255,
        Array.from({ length: branchCount }, () => [0, 0]),
      ),
    );
    const operations = recordingSink();
    expect(queries.reduce((sum, item) => sum + item.branches.length, 0)).toBe(branchTotal);
    expect(
      collectBarrierRegionOwnership(graph, topologicalOrder(graph), queries, operations.sink),
    ).toHaveLength(queries.length);
    expect(operations.counts.node).toBe(512);
    expect(operations.counts.edge).toBe(0);
  });

  test.each([31, 32, 33, 255, 256])(
    'keeps malformed fallback parameterized and counted at V=%i',
    (nodeCount) => {
      const nodeKeys = keys(nodeCount);
      const edges = [...chainEdges(nodeKeys), { from: nodeKeys[nodeCount - 1]!, to: nodeKeys[0]! }];
      const graph = build(nodeKeys, edges);
      const offsets = numericEdges(nodeKeys, edges);
      const queries = Array.from({ length: 2 }, () =>
        query(
          nodeCount - 1,
          Array.from({ length: 32 }, () => [0, nodeCount - 2]),
        ),
      );
      const actual = recordingSink();
      collectBarrierRegionOwnership(graph, null, queries, actual.sink);
      expect(actual.counts).toEqual(regionCounterOracle(nodeCount, offsets, null, queries));
      const branchTotal = 64;
      const regionVolume = actual.counts.region;
      expect(total(actual.counts)).toBeLessThanOrEqual(
        308 * nodeCount +
          48 * edges.length +
          32 * regionVolume +
          150 +
          branchTotal * (6 * nodeCount + 2 * edges.length + 2),
      );
    },
  );

  test.each([
    [2, 64],
    [8, 256],
    [32, 1024],
    [256, 8192],
  ])(
    'accepts valid shared-row amplification at %i queries and Btotal=%i',
    (queryCount, branchTotal) => {
      const nodeKeys = keys(256);
      const graph = build(nodeKeys, chainEdges(nodeKeys));
      const topology = topologicalOrder(graph);
      const queries = Array.from({ length: queryCount }, () =>
        query(
          255,
          Array.from({ length: 32 }, () => [0, 254]),
        ),
      );
      const actual = recordingSink();
      const result = collectBarrierRegionOwnership(graph, topology, queries, actual.sink);
      expect(result).toHaveLength(queryCount);
      expect(queries.reduce((sum, item) => sum + item.branches.length, 0)).toBe(branchTotal);
      expect(actual.counts.node).toBe(512);
      expect(actual.counts.edge).toBe(3 * 255);
      expect(total(actual.counts)).toBeLessThanOrEqual(
        308 * 256 + 48 * 255 + 32 * actual.counts.region + 150,
      );
    },
  );

  test.each([
    [2, 64],
    [8, 256],
    [32, 1024],
  ])(
    'scales malformed fallback with actual Btotal at fixed V/E: %i queries and %i branches',
    (queryCount, branchTotal) => {
      const nodeKeys = keys(32);
      const edges = [...chainEdges(nodeKeys), { from: nodeKeys[31]!, to: nodeKeys[0]! }];
      const graph = build(nodeKeys, edges);
      const offsets = numericEdges(nodeKeys, edges);
      const queries = Array.from({ length: queryCount }, () =>
        query(
          31,
          Array.from({ length: 32 }, () => [0, 30]),
        ),
      );
      const actual = recordingSink();
      collectBarrierRegionOwnership(graph, null, queries, actual.sink);
      expect(queries.reduce((sum, item) => sum + item.branches.length, 0)).toBe(branchTotal);
      expect(actual.counts).toEqual(regionCounterOracle(32, offsets, null, queries));
      expect(total(actual.counts)).toBeLessThanOrEqual(
        308 * 32 +
          48 * edges.length +
          32 * actual.counts.region +
          150 +
          branchTotal * (6 * 32 + 2 * edges.length + 2),
      );
    },
  );

  test('uses total malformed branch volume rather than per-query maximum', () => {
    const nodeKeys = keys(32);
    const edges = [...chainEdges(nodeKeys), { from: nodeKeys[31]!, to: nodeKeys[0]! }];
    const graph = build(nodeKeys, edges);
    const oneDistribution = [
      query(
        31,
        Array.from({ length: 32 }, () => [0, 30]),
      ),
    ];
    const mixedDistribution = [
      query(
        31,
        Array.from({ length: 1 }, () => [0, 30]),
      ),
      query(
        31,
        Array.from({ length: 31 }, () => [0, 30]),
      ),
    ];
    const one = recordingSink();
    const mixed = recordingSink();
    collectBarrierRegionOwnership(graph, null, oneDistribution, one.sink);
    collectBarrierRegionOwnership(graph, null, mixedDistribution, mixed.sink);
    expect(one.counts.node).toBe(mixed.counts.node);
    expect(one.counts.edge).toBe(mixed.counts.edge);
    expect(one.counts.bitsetWord).toBe(mixed.counts.bitsetWord);
    expect(one.counts.readyWord).toBe(mixed.counts.readyWord);
    expect(one.counts.region).not.toBe(mixed.counts.region);
  });

  test('counts malformed edge amplification independently at fixed V/Btotal', () => {
    const nodeKeys = keys(32);
    const sparseEdges: readonly Edge[] = [
      ...chainEdges(nodeKeys),
      { from: nodeKeys[31]!, to: nodeKeys[0]! },
    ];
    const denseEdges: readonly Edge[] = [
      ...sparseEdges,
      ...Array.from({ length: 30 }, (_, offset) => ({
        from: nodeKeys[offset]!,
        to: nodeKeys[offset + 2]!,
      })),
    ];
    const queries = [
      query(
        31,
        Array.from({ length: 32 }, () => [0, 30]),
      ),
    ];
    const sparse = recordingSink();
    const dense = recordingSink();
    collectBarrierRegionOwnership(build(nodeKeys, sparseEdges), null, queries, sparse.sink);
    collectBarrierRegionOwnership(build(nodeKeys, denseEdges), null, queries, dense.sink);
    expect(sparse.counts).toEqual(
      regionCounterOracle(32, numericEdges(nodeKeys, sparseEdges), null, queries),
    );
    expect(dense.counts).toEqual(
      regionCounterOracle(32, numericEdges(nodeKeys, denseEdges), null, queries),
    );
    expect(dense.counts.edge).toBeGreaterThan(sparse.counts.edge);
  });

  test('accepts Btotal 8192 and rejects Btotal 8193 before any counted graph work', () => {
    const nodeKeys = keys(256);
    const graph = build(nodeKeys, [
      { from: nodeKeys[0]!, to: nodeKeys[1]! },
      { from: nodeKeys[1]!, to: nodeKeys[0]! },
    ]);
    const accepted = Array.from({ length: 256 }, () =>
      query(
        1,
        Array.from({ length: 32 }, () => [0, 0]),
      ),
    );
    const acceptedCounts = recordingSink();
    expect(collectBarrierRegionOwnership(graph, null, accepted, acceptedCounts.sink)).toHaveLength(
      256,
    );
    expect(accepted.reduce((sum, item) => sum + item.branches.length, 0)).toBe(8192);

    const rejected = [...accepted, query(1, [[0, 0]])];
    const rejectedCounts = recordingSink();
    expect(rejected.reduce((sum, item) => sum + item.branches.length, 0)).toBe(8193);
    expect(collectBarrierRegionOwnership(graph, null, rejected, rejectedCounts.sink)).toEqual([]);
    expect(rejectedCounts.counts).toEqual(emptyCounts());
  });
});
