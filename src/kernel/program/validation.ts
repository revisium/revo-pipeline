import { Compile } from 'typebox/compile';

import {
  PIPELINE_LIMITS,
  normalizeOwnedEnvelope,
  normalizePortableValue,
  type JsonValue,
} from '../../foundation/index.js';
import {
  admitSchemaValidatedPipelineProgram,
  type ProgramModule,
  type ProgramRegion,
  type ProgramValidationCounters,
} from '../../program/index.js';
import { KernelProgramSchema, type KernelProgram } from '../contracts/program.js';

const kernelProgramValidator = Compile(KernelProgramSchema);

export type ProgramIndex = {
  readonly bundle: KernelProgram;
  readonly modules: ReadonlyMap<string, ProgramModule>;
  readonly regions: ReadonlyMap<string, ProgramRegion>;
};

export type ProgramInspection =
  | { readonly ok: true; readonly index: ProgramIndex }
  | { readonly ok: false };

export type { ProgramValidationCounters };

export const inspectKernelProgram = (
  input: unknown,
  counters?: ProgramValidationCounters,
): ProgramInspection => {
  const owned = normalizeOwnedEnvelope(
    input,
    PIPELINE_LIMITS.machine.liveFrames,
    undefined,
    PIPELINE_LIMITS.machine.serializedStateJsonValues,
  );
  if (!owned.ok || !kernelProgramValidator.Check(owned.value)) {
    return Object.freeze({ ok: false });
  }
  const admission = admitSchemaValidatedPipelineProgram(owned.value.program, counters);
  return admission.ok
    ? Object.freeze({
        ok: true,
        index: Object.freeze({
          bundle: owned.value,
          modules: admission.receipt.index.modules,
          regions: admission.receipt.index.regions,
        }),
      })
    : Object.freeze({ ok: false });
};

export const normalizeKernelInput = (input: unknown): JsonValue | null => {
  const owned = normalizePortableValue(input);
  return owned.ok ? owned.value : null;
};
