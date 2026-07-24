import { expect, test } from 'vitest';

import {
  DECISION_FAULT_PHASES,
  DEFINITION_FAULT_PHASES,
  PIPELINE_LIMITS,
} from '../../../src/policy/index.js';

test('publishes the exact deeply frozen v1 limits', () => {
  expect(PIPELINE_LIMITS).toEqual({
    definition: {
      nodes: 256,
      edges: 1_024,
      declaredFacts: 128,
      branchCasesPerNode: 64,
      predicateValuesPerCase: 64,
      forkBranchesPerNode: 32,
      candidatesPerNode: 32,
      candidatesTotal: 1_024,
      resolutionsPerNode: 32,
      resolutionsTotal: 1_024,
    },
    facts: {
      values: 128,
      nodes: 256,
      candidateVerdicts: 1_024,
      gateResolutions: 256,
      total: 1_664,
    },
    portable: {
      depth: 8,
      objectKeys: 32,
      visitedValues: 16_384,
      nameCodePoints: 64,
      displayCodePoints: 512,
      pathCharacters: 1_024,
      messageCharacters: 512,
      renderingCharacters: 128,
    },
    faults: 100,
  });
  expect(Object.isFrozen(PIPELINE_LIMITS)).toBe(true);
  expect(Object.isFrozen(PIPELINE_LIMITS.definition)).toBe(true);
  expect(Object.isFrozen(PIPELINE_LIMITS.facts)).toBe(true);
  expect(Object.isFrozen(PIPELINE_LIMITS.portable)).toBe(true);
});

test('publishes exhaustive immutable fault phase membership', () => {
  expect(DEFINITION_FAULT_PHASES.flatMap(({ codes }) => codes)).toHaveLength(23);
  expect(DECISION_FAULT_PHASES.flatMap(({ codes }) => codes)).toHaveLength(10);
  expect(new Set(DEFINITION_FAULT_PHASES.flatMap(({ codes }) => codes))).toHaveLength(23);
  expect(new Set(DECISION_FAULT_PHASES.flatMap(({ codes }) => codes))).toHaveLength(10);
  expect(Object.isFrozen(DEFINITION_FAULT_PHASES)).toBe(true);
  expect(Object.isFrozen(DECISION_FAULT_PHASES)).toBe(true);
});
