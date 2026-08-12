import { validateProfileMaterialization } from '../materialization/index.js';
import { validatePipelineSource } from '../source/index.js';
import { proveActivityBound } from './bounds/index.js';
import type { PipelineCompileResult } from './contracts/index.js';
import { validateDataflow } from './dataflow/index.js';
import { emitProgramBundle } from './emission/index.js';
import { linkSource } from './linking/index.js';
import { lowerProgram } from './lowering/index.js';

export const compilePipeline = (
  sourceInput: unknown,
  materializationInput: unknown,
): PipelineCompileResult => {
  const source = validatePipelineSource(sourceInput);
  if (!source.ok) {
    return source;
  }

  const materialization = validateProfileMaterialization(source.value, materializationInput);
  if (!materialization.ok) {
    return materialization;
  }

  const linking = linkSource(source.value.source);
  if (!linking.ok) {
    return linking;
  }

  const dataflow = validateDataflow(source.value.source, materialization.value, linking.value);
  if (!dataflow.ok) {
    return dataflow;
  }

  const bound = proveActivityBound(source.value.source, materialization.value, linking.value);
  if (!bound.ok) {
    return bound;
  }

  const lowered = lowerProgram(source.value, materialization.value);
  const emitted = emitProgramBundle(lowered);
  if (!emitted.ok) {
    return emitted;
  }

  return Object.freeze({
    ok: true,
    sourceDigest: source.value.sourceDigest,
    materializationDigest: materialization.value.materializationDigest,
    programDigest: emitted.programDigest,
    ...emitted.bundle,
  });
};
