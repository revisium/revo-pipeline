import { Compile } from 'typebox/compile';
import { describe, expect, it } from 'vitest';

import {
  createInitialPipelineState,
  FrameKeyPayloadSchema,
  MachineFrameSchema,
} from '../../src/kernel/index.js';
import { kernelDigest } from '../support/kernel-builders.js';
import { machineFrameExamples } from '../support/kernel-contract-examples.js';
import { computeFrameKey, hydratePipelineState } from '../support/kernel-internal.js';
import { activityMapProgram } from '../support/structured-kernel-builders.js';

const structuredKinds = new Set([
  'parallelBranch',
  'repeatBody',
  'mapItem',
  'parallel',
  'repeat',
  'map',
]);

describe('structured machine canonicalization evidence', () => {
  it('validates the structured canonical domain with a closed negative matrix', () => {
    const validator = Compile(MachineFrameSchema);
    const examples = machineFrameExamples().filter(({ kind }) => structuredKinds.has(kind));
    expect(examples).toHaveLength(7);
    for (const example of examples) {
      expect(validator.Check(JSON.parse(JSON.stringify(example)))).toBe(true);
      expect(validator.Check({ ...example, undeclared: true })).toBe(false);
      for (const field of Object.keys(example)) {
        const incomplete = { ...example } as Record<string, unknown>;
        delete incomplete[field];
        expect(validator.Check(incomplete)).toBe(false);
      }
    }
  });

  it('covers structured canonicalization context and rejection edges', () => {
    const frameKeyValidator = Compile(FrameKeyPayloadSchema);
    const parentFrameKey = kernelDigest('2');
    const regionId = kernelDigest('3');
    expect(
      computeFrameKey({ kind: 'mapItem', parentFrameKey, regionId, itemKey: 'e\u0301' }),
    ).toBeNull();
    expect(
      computeFrameKey({ itemKey: 'é', regionId, parentFrameKey, kind: 'mapItem' }),
    ).not.toBeNull();
    expect(
      frameKeyValidator.Check({ kind: 'repeatBody', parentFrameKey, regionId, ordinal: -1 }),
    ).toBe(false);
    expect(
      frameKeyValidator.Check({
        kind: 'mapItem',
        parentFrameKey,
        regionId,
        itemKey: 'a',
        undeclared: true,
      }),
    ).toBe(false);

    const initial = createInitialPipelineState(activityMapProgram({ kind: 'collect' }), {});
    const hydrated = hydratePipelineState(JSON.parse(JSON.stringify(initial.state)));
    expect(hydrated).not.toBeNull();
    expect(hydrated?.frames.map(({ key }) => key)).toEqual(
      hydrated?.frames.map(({ key }) => key).toSorted(),
    );
    expect(Object.isFrozen(hydrated)).toBe(true);
    expect(
      hydratePipelineState({ ...initial.state, frames: [...initial.state.frames].reverse() }),
    ).toBeNull();
    expect(hydratePipelineState({ ...initial.state, undeclared: true })).toBeNull();
  });
});
