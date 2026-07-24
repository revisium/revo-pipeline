import { describe, expect, test } from 'vitest';

import {
  buildGraphAdjacency,
  collectRegionMembers,
  nodesLeadingToTerminals,
  reachableNodeKeys,
  topologicalSort,
} from '../../../src/graph/index.js';

const edges = [
  { from: 'a', to: 'c' },
  { from: 'b', to: 'c' },
  { from: 'c', to: 'd' },
];

describe('graph algorithms', () => {
  test('uses key ordering for topological ties and detects cycles', () => {
    expect(topologicalSort(['d', 'c', 'b', 'a'], edges)).toEqual(['a', 'b', 'c', 'd']);
    expect(
      topologicalSort(
        ['a', 'b'],
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      ),
    ).toBeNull();
  });

  test('derives forward, reverse and barrier-bounded reachability', () => {
    expect([...reachableNodeKeys('a', edges)]).toEqual(['a', 'c', 'd']);
    expect([...nodesLeadingToTerminals(['d'], edges)]).toEqual(['d', 'c', 'b', 'a']);
    expect(
      [
        ...collectRegionMembers(
          'a',
          'c',
          'd',
          buildGraphAdjacency([...edges, { from: 'c', to: 'outside' }]),
        ),
      ].sort(),
    ).toEqual(['a', 'c']);
  });
});
