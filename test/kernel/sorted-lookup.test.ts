import { describe, expect, it } from 'vitest';

import { findSorted } from '../support/kernel-internal.js';

describe('shared kernel value lookup', () => {
  it('preserves Unicode ordering, comparison counters, and null misses', () => {
    const values = [{ key: 'a' }, { key: '\u{ffff}' }, { key: '\u{10000}' }];
    const counters = { comparisons: 0, ancestrySteps: 0 };

    expect(findSorted(values, '\u{ffff}', ({ key }) => key, counters)).toBe(values[1]);
    expect(counters).toEqual({ comparisons: 1, ancestrySteps: 0 });
    expect(findSorted(values, 'missing', ({ key }) => key)).toBeNull();
  });

  it('preserves ASCII digest lookup and defensive sparse-array corruption behavior', () => {
    const values = [{ key: 'sha256:0' }, { key: 'sha256:7' }, { key: 'sha256:f' }];
    expect(findSorted(values, 'sha256:f', ({ key }) => key)).toBe(values[2]);

    const sparse = new Array<{ readonly key: string }>(1);
    expect(findSorted(sparse, 'sha256:0', ({ key }) => key)).toBeNull();
  });
});
