import { describe, expect, it } from 'vitest';

import { EmptyObjectSchema } from '../../src/foundation/index.js';
import { createInitialPipelineState } from '../../src/kernel/index.js';
import {
  PROGRAM_ADMISSION_LIMITS,
  admitOwnedPipelineProgram,
  analyzeProgram,
  type ProgramNode,
  type ProgramRegion,
  type ProgramValidationCounters,
} from '../../src/program/index.js';
import {
  mapRegion,
  parallelRegion,
  productionWork,
  program,
} from '../support/admission-program-fixtures.js';
import { literalMapQueue, literalParallelQueue } from '../support/admission-reference-model.js';
import { kernelModule, kernelProgram } from '../support/kernel-builders.js';
import { programRegion } from '../support/program-builders.js';

describe('independent literal queue admission model', () => {
  it('requires every Program region exit schema to fit its region output schema', () => {
    const acceptedRegion = programRegion();
    const rejectedRegion: ProgramRegion = { ...acceptedRegion, outputSchema: { type: 'string' } };

    expect(admitOwnedPipelineProgram(program(acceptedRegion))).toMatchObject({ ok: true });
    expect(admitOwnedPipelineProgram(program(rejectedRegion))).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects an oversized structure before indexing or quadratic dataflow', () => {
    const node = (ordinal: number): ProgramNode => ({
      kind: 'end',
      id: `sha256:${ordinal.toString(16).padStart(64, '0')}`,
      outcome: 'ok',
      output: {},
    });
    const nodes = Array.from({ length: PROGRAM_ADMISSION_LIMITS.nodes + 1 }, (_, index) =>
      node(index + 1),
    );
    const [entry, ...remaining] = nodes;
    if (entry === undefined) {
      throw new TypeError('Expected an oversized node population.');
    }
    const region: ProgramRegion = {
      id: `sha256:${(nodes.length + 1).toString(16).padStart(64, '0')}`,
      inputSchema: EmptyObjectSchema,
      entry: entry.id,
      outputSchema: EmptyObjectSchema,
      exits: [{ outcome: 'ok', outputSchema: EmptyObjectSchema }],
      nodes: [entry, ...remaining],
    };
    const counters: ProgramValidationCounters = {
      admissionAnalyses: 0,
      classificationExitInspections: 0,
      modules: 0,
      regions: 0,
      nodes: 0,
      targets: 0,
    };

    expect(admitOwnedPipelineProgram(program(region), counters)).toMatchObject({
      ok: false,
      reason: 'bounds',
      violation: {
        limit: 'nodes',
        actual: PROGRAM_ADMISSION_LIMITS.nodes + 1,
        maximum: PROGRAM_ADMISSION_LIMITS.nodes,
      },
    });
    expect(counters).toEqual({
      admissionAnalyses: 0,
      classificationExitInspections: 0,
      modules: 0,
      regions: 0,
      nodes: 0,
      targets: 0,
    });
  });

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
