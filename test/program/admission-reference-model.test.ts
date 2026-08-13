import { describe, expect, it } from 'vitest';

import { createInitialPipelineState } from '../../src/kernel/index.js';
import { PROGRAM_ADMISSION_LIMITS, analyzeProgram } from '../../src/program/index.js';
import {
  mapRegion,
  parallelRegion,
  productionWork,
  program,
} from '../support/admission-program-fixtures.js';
import { literalMapQueue, literalParallelQueue } from '../support/admission-reference-model.js';
import { kernelModule, kernelProgram } from '../support/kernel-builders.js';

describe('independent literal queue admission model', () => {
  it('pins the exact 65,536 accepted and 65,537 rejected work boundary', () => {
    const acceptedRegion = mapRegion(86, 757, 2);
    const rejectedRegion = mapRegion(86, 757, 3);
    expect(literalMapQueue(86, 757, 2)).toBe(65_536);
    expect(literalMapQueue(86, 757, 3)).toBe(65_537);
    expect(productionWork(acceptedRegion).start).toBe(65_536);
    expect(productionWork(rejectedRegion).start).toBe(65_537);
    expect(analyzeProgram(program(acceptedRegion)).ok).toBe(true);
    expect(analyzeProgram(program(rejectedRegion))).toMatchObject({
      ok: false,
      violation: { limit: 'synchronousWork', actual: 65_537, maximum: 65_536 },
    });
  });

  it('executes the exactly admitted 65,536-work map without rebuilding item descriptors', () => {
    const region = mapRegion(86, 757, 2);
    const initialized = createInitialPipelineState(
      kernelProgram([kernelModule('main', region)]),
      {},
    );
    expect(productionWork(region).start).toBe(65_536);
    expect(initialized).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [] },
      commands: [{ kind: 'complete' }],
    });
  }, 60_000);

  it('executes a maximum-size 1,024-item map at concurrency one', () => {
    const region = mapRegion(1_024, 2, 2);
    const initialized = createInitialPipelineState(
      kernelProgram([kernelModule('main', region)]),
      {},
    );
    expect(productionWork(region).start).toBe(7_172);
    expect(initialized).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [] },
      commands: [{ kind: 'complete' }],
    });
  }, 60_000);

  it('adds two 40,000 sibling bursts instead of taking their scalar maximum', () => {
    const work = productionWork(parallelRegion(40_000));
    expect(literalParallelQueue([40_000, 40_000])).toBe(80_010);
    expect(work.start).toBe(80_010);
  });

  it('pins every admission coordinate owned by Program analysis', () => {
    expect(PROGRAM_ADMISSION_LIMITS).toEqual({
      modules: 64,
      nodes: 4_096,
      regions: 4_096,
      targets: 16_384,
      nestingDepth: 32,
      callDepth: 32,
      synchronousWork: 65_536,
      liveFrames: 16_384,
      liveOperations: 16_384,
      nodeResults: 65_536,
      collectionSlots: 262_144,
      cancellationMemberships: 65_536,
      stateJsonValues: 1_048_576,
      commandJsonValues: 1_048_576,
    });
  });
});
