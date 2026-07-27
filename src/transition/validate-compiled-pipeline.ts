import type { CompiledPipeline } from '../spec/index.js';
import { validateCompiledInternally } from './compiled/validate-compiled-internally.js';

export const validateCompiledPipeline = (
  input: unknown,
): { readonly ok: true; readonly pipeline: CompiledPipeline } | { readonly ok: false } => {
  const validated = validateCompiledInternally(input);
  return validated.ok ? { ok: true, pipeline: validated.snapshot } : { ok: false };
};
