import type { CompiledPipelineDecoding } from '../errors/index.js';
import { inspectCompiledPipeline } from './inspect-compiled-pipeline.js';

export const decodeCompiledPipeline = (input: unknown): CompiledPipelineDecoding => {
  const validated = inspectCompiledPipeline(input);
  return validated.ok
    ? Object.freeze({ ok: true, pipeline: validated.snapshot })
    : Object.freeze({ ok: false, faults: validated.faults });
};
