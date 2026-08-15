import { describe, expect, it } from 'vitest';

import {
  PIPELINE_LIMITS,
  compareUnicodeCodePoints,
  isIdentifier,
} from '../../src/foundation/index.js';

const referenceCompare = (left: string, right: string): number => {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
};

const sign = (value: number): number => Math.sign(value);

describe('Unicode scalar utilities', () => {
  it('uses the platform well-formed UTF-16 predicate at the NFC boundary', () => {
    expect('😀'.isWellFormed()).toBe(true);
    expect('\ud800'.isWellFormed()).toBe(false);
  });

  it('matches the allocating reference across BMP, astral, and prefix populations', () => {
    const scalars = ['', '\0', 'A', 'é', '\u{e000}', '\u{ffff}', '😀', '\u{10000}', '\u{10ffff}'];
    const population = [
      ...scalars,
      ...scalars.flatMap((left) => scalars.map((right) => `${left}${right}`)),
    ];

    for (const left of population) {
      for (const right of population) {
        expect(sign(compareUnicodeCodePoints(left, right))).toBe(
          sign(referenceCompare(left, right)),
        );
      }
    }
  });

  it('counts astral identifiers by code point at the exact identifier boundary', () => {
    const exact = '😀'.repeat(PIPELINE_LIMITS.identifierCodePoints);
    expect(Array.from(exact)).toHaveLength(PIPELINE_LIMITS.identifierCodePoints);
    expect(isIdentifier(exact)).toBe(true);
    expect(isIdentifier(`${exact}😀`)).toBe(false);
  });

  it.each([
    ['', '', 0],
    ['a', 'aa', -1],
    ['aa', 'a', 1],
    ['\u{ffff}', '\u{10000}', -1],
    ['😀', '\u{e000}', 1],
    ['a😀', 'a\u{10000}', 1],
  ] as const)('orders %j against %j by scalar value', (left, right, expected) => {
    expect(sign(compareUnicodeCodePoints(left, right))).toBe(expected);
  });
});
