import { compareUnicodeCodePoints } from '../../foundation/index.js';

export type LookupCounters = { comparisons: number; ancestrySteps: number };

const recordComparison = (counters?: LookupCounters): void => {
  if (counters !== undefined) {
    counters.comparisons += 1;
  }
};

export const findSorted = <Value>(
  values: readonly Value[],
  target: string,
  key: (value: Value) => string,
  counters?: LookupCounters,
): Value | null => {
  let lower = 0;
  let upper = values.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const value = values[middle];
    if (value === undefined) {
      return null;
    }
    recordComparison(counters);
    const order = compareUnicodeCodePoints(key(value), target);
    if (order === 0) {
      return value;
    }
    if (order < 0) {
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return null;
};
