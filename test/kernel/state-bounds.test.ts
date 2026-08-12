import { describe, expect, it } from 'vitest';

import type { JsonValue } from '../../src/foundation/index.js';
import type { RootRegionMachineFrame } from '../../src/kernel/index.js';
import { kernelDigest } from '../support/kernel-builders.js';
import {
  hydratePipelineState,
  insertCanonicalNodeResult,
  type NodeResultOrderingCounters,
} from '../support/kernel-internal.js';

const objectWithKeys = (count: number): Record<string, JsonValue> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [String(index).padStart(4, '0'), index]),
  );

const nodeId = (ordinal: number) => `sha256:${ordinal.toString(16).padStart(64, '0')}` as const;

const frameWith = (
  input: JsonValue,
  nodeResults: RootRegionMachineFrame['nodeResults'],
): RootRegionMachineFrame => ({
  kind: 'rootRegion',
  key: kernelDigest('1'),
  parentFrameKey: null,
  scopeInput: input,
  nodeResults,
  regionId: kernelDigest('2'),
  status: 'active',
  ready: [kernelDigest('3')],
  selectedExit: null,
});

const stateWith = (frame: RootRegionMachineFrame) => ({
  schemaVersion: 'pipeline-state/v1' as const,
  programDigest: kernelDigest(),
  status: 'running' as const,
  input: frame.scopeInput,
  frames: [frame],
  pending: [],
  resolved: [],
  runCancellation: null,
  regionCancellations: [],
  result: null,
  fault: null,
});

const sequentialResults = (count: number, counters: NodeResultOrderingCounters) => {
  let results: RootRegionMachineFrame['nodeResults'] = Object.freeze({});
  for (let ordinal = count; ordinal > 0; ordinal -= 1) {
    const inserted = insertCanonicalNodeResult(
      results,
      nodeId(ordinal),
      Object.freeze({ status: 'succeeded', output: ordinal }),
      counters,
    );
    if (inserted === null) {
      throw new TypeError('Expected a unique node result.');
    }
    results = inserted;
  }
  return results;
};

const projectedResults = (count: number): RootRegionMachineFrame['nodeResults'] => {
  const results: Record<string, { readonly status: 'succeeded'; readonly output: number }> = {};
  for (let ordinal = 1; ordinal <= count; ordinal += 1) {
    results[nodeId(ordinal)] = Object.freeze({ status: 'succeeded', output: ordinal });
  }
  return Object.freeze(results);
};

describe('kernel state bounds and result ordering', () => {
  it('keeps nested portable objects at 64 keys and rejects 65', () => {
    const accepted = stateWith(frameWith(objectWithKeys(64), {}));
    const rejected = stateWith(frameWith(objectWithKeys(65), {}));

    expect(hydratePipelineState(accepted)).not.toBeNull();
    expect(hydratePipelineState(rejected)).toBeNull();
  });

  it.each([64, 65, 4_096])('accepts %i canonical structural node results', (count) => {
    const nodeResults = projectedResults(count);
    const hydrated = hydratePipelineState(stateWith(frameWith({}, nodeResults)));

    expect(hydrated).not.toBeNull();
    expect(Object.keys(nodeResults)).toEqual(Object.keys(nodeResults).toSorted());
    expect(Object.isFrozen(nodeResults)).toBe(true);
  });

  it('uses bounded binary ordering work across full reverse progression', () => {
    const counters: NodeResultOrderingCounters = { assignments: 0, comparisons: 0 };
    const nodeResults = sequentialResults(4_096, counters);

    expect(Object.keys(nodeResults)).toHaveLength(4_096);
    expect(Object.keys(nodeResults)).toEqual(Object.keys(nodeResults).toSorted());
    expect(Object.isFrozen(nodeResults)).toBe(true);
    expect(counters.assignments).toBe(8_390_656);
    expect(counters.comparisons).toBeLessThanOrEqual(4_096 * 12);
  }, 10_000);

  it('does not replace or mutate an existing result', () => {
    const original = projectedResults(1);
    const counters: NodeResultOrderingCounters = { assignments: 0, comparisons: 0 };

    expect(
      insertCanonicalNodeResult(
        original,
        nodeId(1),
        Object.freeze({ status: 'succeeded', output: 'replacement' }),
        counters,
      ),
    ).toBeNull();
    expect(original[nodeId(1)]).toEqual({ status: 'succeeded', output: 1 });
    expect(counters).toEqual({ assignments: 0, comparisons: 0 });
  });

  it('hydrates and round-trips a maximum structural result record', () => {
    const state = stateWith(frameWith({}, projectedResults(4_096)));
    const hydrated = hydratePipelineState(JSON.parse(JSON.stringify(state)));

    expect(hydrated).not.toBeNull();
    expect(JSON.parse(JSON.stringify(hydrated))).toEqual(state);
  });
});
