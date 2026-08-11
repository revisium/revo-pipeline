import { expect } from 'vitest';

import {
  type PipelineSourceValidationResult,
  validatePipelineSource,
} from '../../src/source/index.js';

export const expectValidSource = (input: unknown) => {
  const result = validatePipelineSource(input);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected a valid source: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.value;
};

export const sourceDiagnostics = (input: unknown) => {
  const result: PipelineSourceValidationResult = validatePipelineSource(input);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected source diagnostics.');
  }
  return result.diagnostics.map(({ code, path }) => ({ code, path }));
};
