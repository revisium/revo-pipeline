import { describe, expect, it } from 'vitest';

import type { ProgramNode, ProgramNodeId } from '../../src/program/index.js';
import { kernelModule, kernelProgram, kernelRegion } from '../support/kernel-builders.js';
import {
  inspectKernelProgram,
  type ProgramValidationCounters,
} from '../support/kernel-internal.js';

const digestFromNumber = (value: number): ProgramNodeId =>
  `sha256:${value.toString(16).padStart(64, '0')}`;

const nonEmpty = <Value>(values: readonly Value[]): [Value, ...Value[]] => {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new TypeError('Expected a non-empty collection.');
  }
  return [first, ...rest];
};

const classificationPopulationProgram = () => {
  const outcomes = Array.from(
    { length: 1_024 },
    (_, index) => `outcome-${String(index).padStart(4, '0')}`,
  );
  const branches = Array.from({ length: 32 }, (_, branchIndex) => {
    const end = {
      kind: 'end' as const,
      id: digestFromNumber(300_000 + branchIndex),
      outcome: outcomes[0]!,
      output: {},
    };
    return {
      key: `branch-${String(branchIndex).padStart(2, '0')}`,
      input: {},
      region: kernelRegion([end], {
        id: digestFromNumber(310_000 + branchIndex),
        outcomes,
      }),
      exits: nonEmpty(
        outcomes.map((outcome) => ({ outcome, classification: 'qualifies' as const })),
      ),
    };
  });
  const [firstBranch, secondBranch, ...remainingBranches] = branches;
  if (firstBranch === undefined || secondBranch === undefined) {
    throw new TypeError('Expected classification branches.');
  }
  const end = {
    kind: 'end' as const,
    id: digestFromNumber(320_001),
    outcome: 'ok',
    output: {},
  };
  const parallel: ProgramNode = {
    kind: 'parallel',
    id: digestFromNumber(320_000),
    mode: 'generic',
    branches: [firstBranch, secondBranch, ...remainingBranches],
    policy: { kind: 'all' },
    remaining: 'drain',
    next: end.id,
  };
  return kernelProgram([
    kernelModule('main', kernelRegion([parallel, end], { id: digestFromNumber(320_002) })),
  ]);
};

describe('kernel structured validation performance', () => {
  it('inspects each exit exactly once at the maximum branch population', () => {
    const counters: ProgramValidationCounters = {
      admissionAnalyses: 0,
      classificationExitInspections: 0,
      modules: 0,
      regions: 0,
      nodes: 0,
      targets: 0,
    };

    expect(inspectKernelProgram(classificationPopulationProgram(), counters).ok).toBe(true);
    expect(counters.classificationExitInspections).toBe(32 * 1_024);
  });
});
