import { compareUnicodeCodePoints } from '../../foundation/index.js';

export type LookupCounters = { comparisons: number; ancestrySteps: number };

type RecordComparison = () => void;

const recordComparison = (counters?: LookupCounters): void => {
  if (counters !== undefined) {
    counters.comparisons += 1;
  }
};

export const findSortedIndex = <Value>(
  values: readonly Value[],
  target: string,
  key: (value: Value) => string,
  onComparison?: RecordComparison,
): number | null => {
  let lower = 0;
  let upper = values.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const value = values[middle];
    if (value === undefined) {
      return null;
    }
    onComparison?.();
    const order = compareUnicodeCodePoints(key(value), target);
    if (order === 0) {
      return middle;
    }
    if (order < 0) {
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return null;
};

export const findSortedInsertionIndex = <Value>(
  values: readonly Value[],
  target: string,
  key: (value: Value) => string,
  onComparison?: RecordComparison,
): number => {
  let lower = 0;
  let upper = values.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const value = values[middle];
    onComparison?.();
    if (value !== undefined && compareUnicodeCodePoints(key(value), target) < 0) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
};

export const findSorted = <Value>(
  values: readonly Value[],
  target: string,
  key: (value: Value) => string,
  counters?: LookupCounters,
): Value | null => {
  const index = findSortedIndex(values, target, key, () => recordComparison(counters));
  return index === null ? null : (values[index] ?? null);
};
