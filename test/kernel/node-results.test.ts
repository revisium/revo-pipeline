import { describe, expect, it } from 'vitest';

import type { NodeTerminalResult } from '../../src/kernel/index.js';
import { insertCanonicalNodeResult } from '../support/kernel-internal.js';

const result = (output: number): NodeTerminalResult =>
  Object.freeze({ status: 'succeeded', output });

const nodeId = (digit: string): `sha256:${string}` => `sha256:${digit.repeat(64)}`;
const a = nodeId('a');
const b = nodeId('b');
const c = nodeId('c');
const d = nodeId('d');

describe('canonical node results', () => {
  it('inserts at the middle and end without changing an immutable input', () => {
    const input = Object.freeze({ [a]: result(1), [c]: result(3) });
    const middle = insertCanonicalNodeResult(input, b, result(2));

    expect(middle).not.toBeNull();
    expect(Object.keys(middle ?? {})).toEqual([a, b, c]);
    expect(Object.isFrozen(middle)).toBe(true);
    expect(Object.keys(input)).toEqual([a, c]);

    const appended = middle === null ? null : insertCanonicalNodeResult(middle, d, result(4));
    expect(Object.keys(appended ?? {})).toEqual([a, b, c, d]);
    expect(insertCanonicalNodeResult(appended ?? {}, d, result(5))).toBeNull();
  });

  it('reports binary-search comparisons and canonical-copy assignments', () => {
    const counters = { comparisons: 0, assignments: 0 };

    const inserted = insertCanonicalNodeResult(
      Object.freeze({ [a]: result(1), [c]: result(3) }),
      b,
      result(2),
      counters,
    );

    expect(Object.keys(inserted ?? {})).toEqual([a, b, c]);
    expect(counters).toEqual({ comparisons: 2, assignments: 3 });
  });
});
