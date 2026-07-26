import type { CompiledPipeline } from '../spec/index.js';
import { validateCompiledInternally } from './validate-compiled-internally.js';

export const validateCompiledPipeline = (
  input: unknown,
): { readonly ok: true; readonly pipeline: CompiledPipeline } | { readonly ok: false } => {
  const validated = validateCompiledInternally(input);
  return validated.ok ? { ok: true, pipeline: validated.pipeline } : { ok: false };
};
