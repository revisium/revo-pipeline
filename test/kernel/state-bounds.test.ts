import { describe, expect, it } from 'vitest';

import type { Digest, JsonValue } from '../../src/foundation/index.js';
import type {
  MachineFrame,
  PendingOperation,
  PipelineState,
  RegionCancellation,
  ResolvedOperation,
} from '../../src/kernel/index.js';
import { kernelDigest } from '../support/kernel-builders.js';
import {
  createTransitionDraft,
  hydratePipelineState,
  stateFitsMachineLimits,
} from '../support/kernel-internal.js';

const digest = (ordinal: number): Digest => `sha256:${ordinal.toString(16).padStart(64, '0')}`;

const state = (change: Partial<PipelineState> = {}): PipelineState => ({
  schemaVersion: 'pipeline-state/v1',
  programDigest: kernelDigest(),
  status: 'running',
  input: null,
  frames: [],
  pending: [],
  resolved: [],
  runCancellation: null,
  regionCancellations: [],
  result: null,
  fault: null,
  ...change,
});

const rootFrame = (
  ordinal: number,
  nodeResults: MachineFrame['nodeResults'] = {},
): MachineFrame => ({
  kind: 'rootRegion',
  key: digest(ordinal),
  parentFrameKey: null,
  scopeInput: null,
  nodeResults,
  regionId: digest(20_000 + ordinal),
  status: 'active',
  ready: [],
  selectedExit: null,
});

const operation = (ordinal: number): PendingOperation => ({
  kind: 'activity',
  commandKey: digest(ordinal),
  ref: { programDigest: kernelDigest(), frameKey: digest(50_000), nodeId: digest(60_000) },
  requirementKey: 'work',
});

const receipt = (ordinal: number): ResolvedOperation => ({
  commandKey: digest(ordinal),
  ref: { programDigest: kernelDigest(), frameKey: digest(50_000), nodeId: digest(60_000) },
  eventDigest: digest(70_000 + ordinal),
});

describe('Machine semantic state bounds', () => {
  it('accepts and rejects the exact live-frame boundary', () => {
    const frames = Array.from({ length: 16_385 }, (_, index) => rootFrame(index + 1));
    expect(stateFitsMachineLimits(state({ frames: frames.slice(0, 16_384) }))).toBe(true);
    expect(stateFitsMachineLimits(state({ frames }))).toBe(false);
  });

  it('bounds pending plus resolved operations jointly', () => {
    const pending = Array.from({ length: 8_193 }, (_, index) => operation(index + 1));
    const resolved = Array.from({ length: 8_192 }, (_, index) => receipt(index + 20_000));
    expect(stateFitsMachineLimits(state({ pending: pending.slice(0, 8_192), resolved }))).toBe(
      true,
    );
    expect(stateFitsMachineLimits(state({ pending, resolved }))).toBe(false);
  });

  it('bounds cumulative node results across frames', () => {
    const frames = Array.from({ length: 16 }, (_, frameIndex) => {
      const results = Object.fromEntries(
        Array.from({ length: 4_096 }, (unused, resultIndex) => [
          digest(frameIndex * 4_096 + resultIndex + 1),
          { status: 'cancelled' as const },
        ]),
      );
      return rootFrame(80_000 + frameIndex, results);
    });
    expect(stateFitsMachineLimits(state({ frames }))).toBe(true);
    expect(
      stateFitsMachineLimits(
        state({
          frames: [...frames, rootFrame(90_000, { [digest(90_001)]: { status: 'cancelled' } })],
        }),
      ),
    ).toBe(false);
  });

  it('bounds structural collection slots without allocating the plan activity bound', () => {
    const keys = Array.from(
      { length: 1_024 },
      (_, index) => `item-${String(index).padStart(4, '0')}`,
    );
    const maps: MachineFrame[] = Array.from({ length: 51 }, (unusedMap, index) => ({
      kind: 'map',
      key: digest(100_000 + index),
      parentFrameKey: digest(110_000),
      scopeInput: null,
      nodeResults:
        index === 50
          ? Object.fromEntries(
              Array.from({ length: 820 }, (unusedResult, ordinal) => [
                digest(130_000 + ordinal),
                { status: 'cancelled' as const },
              ]),
            )
          : {},
      nodeId: digest(120_000),
      itemKeys: keys,
      itemSourceIndexes: keys.map((unusedKey, ordinal) => ordinal),
      pendingItemKeys: keys,
      activeItemKeys: keys,
      completedItems: keys.map((itemKey) => ({
        itemKey,
        status: 'cancelled',
        output: null,
        failure: null,
      })),
      status: 'active',
      selected: null,
      selectedFailureItemKey: null,
    }));
    expect(stateFitsMachineLimits(state({ frames: maps }))).toBe(true);
    const last = maps.at(-1);
    if (last?.kind !== 'map') {
      throw new TypeError('Expected final map frame.');
    }
    const overflow: MachineFrame = {
      ...last,
      nodeResults: {
        ...last.nodeResults,
        [digest(140_000)]: { status: 'cancelled' },
      },
    };
    expect(stateFitsMachineLimits(state({ frames: [...maps.slice(0, -1), overflow] }))).toBe(false);
  });

  it('charges each map owner an exact five-item slope and four-slot constant', () => {
    const map = (ordinal: number, count: number): MachineFrame => {
      const itemKeys = Array.from({ length: count }, (_, index) => `item-${index}`);
      return {
        kind: 'map',
        key: digest(150_000 + ordinal),
        parentFrameKey: digest(160_000),
        scopeInput: null,
        nodeResults: {},
        nodeId: digest(170_000),
        itemKeys,
        itemSourceIndexes: itemKeys.map((unusedKey, index) => index),
        pendingItemKeys: itemKeys,
        activeItemKeys: [],
        completedItems: [],
        status: 'active',
        selected: null,
        selectedFailureItemKey: null,
      };
    };
    const maps = Array.from({ length: 51 }, (_, index) => map(index, 1_024));
    const roots = Array.from({ length: 826 }, (_, index) => rootFrame(200_000 + index));

    expect(stateFitsMachineLimits(state({ frames: [...maps, ...roots.slice(0, 820)] }))).toBe(true);
    expect(stateFitsMachineLimits(state({ frames: [...maps, ...roots.slice(0, 821)] }))).toBe(
      false,
    );

    const oneFewerItem = [map(0, 1_023), ...maps.slice(1)];
    expect(
      stateFitsMachineLimits(state({ frames: [...oneFewerItem, ...roots.slice(0, 825)] })),
    ).toBe(true);
    expect(
      stateFitsMachineLimits(state({ frames: [...oneFewerItem, ...roots.slice(0, 826)] })),
    ).toBe(false);

    expect(
      stateFitsMachineLimits(state({ frames: [...maps, map(1_000, 0), ...roots.slice(0, 816)] })),
    ).toBe(true);
    expect(
      stateFitsMachineLimits(state({ frames: [...maps, map(1_000, 0), ...roots.slice(0, 817)] })),
    ).toBe(false);
  });

  it('bounds cancellation memberships across overlapping sets', () => {
    const awaiting = (offset: number) =>
      Array.from({ length: 16_384 }, (_, index) => digest(offset + index));
    const cancellations: RegionCancellation[] = Array.from({ length: 5 }, (_, index) => ({
      frameKey: digest(200_000 + index),
      reasonCode: 'cleanup',
      awaiting: awaiting(300_000 + index * 20_000),
    }));
    expect(stateFitsMachineLimits(state({ regionCancellations: cancellations.slice(0, 4) }))).toBe(
      true,
    );
    expect(stateFitsMachineLimits(state({ regionCancellations: cancellations }))).toBe(false);
  });

  it('accepts exactly 1,048,576 JSON occurrences and rejects one more', () => {
    const occurrences = (value: JsonValue): number => {
      if (typeof value !== 'object' || value === null) {
        return 1;
      }
      return (
        1 + Object.values(value).reduce<number>((total, child) => total + occurrences(child), 0)
      );
    };
    const values = Array.from({ length: 1_020 }, () => Array.from({ length: 1_024 }, () => 0));
    const measured = state({
      frames: [
        rootFrame(
          250_000,
          Object.fromEntries(
            values.map((output, index) => [
              digest(300_000 + index),
              { status: 'succeeded' as const, output },
            ]),
          ),
        ),
      ],
    });
    const missing = 1_048_576 - occurrences(measured);
    const exact = {
      ...measured,
      input: Array.from({ length: missing }, () => 0),
    } satisfies PipelineState;
    expect(occurrences(exact)).toBe(1_048_576);
    expect(hydratePipelineState(exact)).not.toBeNull();
    expect(createTransitionDraft(exact).state()).not.toBeNull();
    const overflow = { ...exact, input: [...exact.input, 0] } satisfies PipelineState;
    expect(occurrences(overflow)).toBe(1_048_577);
    expect(hydratePipelineState(overflow)).toBeNull();
    expect(createTransitionDraft(overflow).state()).toBeNull();
  }, 20_000);
});
