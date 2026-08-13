import { describe, expect, it } from 'vitest';

import {
  PIPELINE_LIMITS,
  addWithinLimit,
  isSafeIntegerInRange,
  multiplyWithinLimit,
} from '../../src/foundation/index.js';

describe('pipeline bounds', () => {
  it('pins every normative foundation and package limit', () => {
    expect(PIPELINE_LIMITS).toEqual({
      identifierCodePoints: 64,
      displayStringCodePoints: 512,
      portableValue: { depth: 16, objectKeys: 64, arrayItems: 1_024, visitedValues: 65_536 },
      sourcePackage: {
        modules: 64,
        nodes: 4_096,
        targets: 16_384,
        nestingDepth: 32,
        callDepth: 32,
        totalActivities: 1_000_000,
      },
      program: { nodes: 4_096, regions: 4_096, targets: 16_384 },
      structured: { participants: 32, repeatIterations: 100, mapItems: 1_024 },
      machine: {
        synchronousStepsPerTransition: 65_536,
        liveFrames: 16_384,
        liveOperations: 16_384,
        totalNodeResults: 65_536,
        structuralCollectionSlots: 262_144,
        cancellationMemberships: 65_536,
        serializedStateJsonValues: 1_048_576,
        commandJsonValuesPerTransition: 1_048_576,
      },
      diagnostics: 100,
    });
  });

  it.each([
    [1, 1, 10, 2],
    [0, 10, 10, 10],
    [Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [8, 3, 10, null],
    [-1, 1, 10, null],
    [1.5, 1, 10, null],
  ])('adds %s and %s within %s', (left, right, limit, expected) => {
    expect(addWithinLimit(left, right, limit)).toBe(expected);
  });

  it.each([
    [2, 3, 10, 6],
    [0, Number.MAX_SAFE_INTEGER, 0, 0],
    [4, 3, 10, null],
    [-1, 1, 10, null],
    [1, 1.5, 10, null],
  ])('multiplies %s and %s within %s', (left, right, limit, expected) => {
    expect(multiplyWithinLimit(left, right, limit)).toBe(expected);
  });

  it('recognizes only safe integers inside an inclusive range', () => {
    expect(isSafeIntegerInRange(1, 1, 2)).toBe(true);
    expect(isSafeIntegerInRange(2, 1, 2)).toBe(true);
    expect(isSafeIntegerInRange(0, 1, 2)).toBe(false);
    expect(isSafeIntegerInRange(1.5, 1, 2)).toBe(false);
    expect(isSafeIntegerInRange(Number.MAX_SAFE_INTEGER + 1, 1, Number.MAX_SAFE_INTEGER)).toBe(
      false,
    );
  });
});
