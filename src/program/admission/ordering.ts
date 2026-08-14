import { compareUnicodeCodePoints } from '../../foundation/index.js';

export const isStrictlySorted = <Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (
      previous === undefined ||
      current === undefined ||
      compareUnicodeCodePoints(key(previous), key(current)) >= 0
    ) {
      return false;
    }
  }
  return true;
};

export const sameOrderedKeys = <Left, Right>(
  left: readonly Left[],
  right: readonly Right[],
  leftKey: (value: Left) => string,
  rightKey: (value: Right) => string,
): boolean =>
  left.length === right.length &&
  left.every((value, index) => leftKey(value) === rightKey(right[index]!));
