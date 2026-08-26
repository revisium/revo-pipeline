import { expect } from 'vitest';

import {
  type PipelineSelections,
  validatePipelineSelections,
} from '../../src/materialization/index.js';
import { validatePipelineSource } from '../../src/source/index.js';
import { agentSource } from './source-builders.js';

export const validatedSource = (source = agentSource()) => {
  const result = validatePipelineSource(source);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('Expected valid source fixture.');
  }
  return result.value;
};

export const singleMaterialization = (_sourceDigest: `sha256:${string}`): PipelineSelections => ({
  a: { strategy: 'single', participant: { key: 'p1', bindingKey: 'b1' } },
});

export const expectValidMaterialization = (input: unknown, source = validatedSource()) => {
  const result = validatePipelineSelections(source, input);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected valid materialization: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.value;
};

export const materializationDiagnostics = (input: unknown, source = validatedSource()) => {
  const result = validatePipelineSelections(source, input);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected materialization diagnostics.');
  }
  return result.diagnostics.map(({ code, path }) => ({ code, path }));
};
