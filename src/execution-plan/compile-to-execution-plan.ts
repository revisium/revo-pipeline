import { compilePipeline, type PipelineCompileResult } from '../compiler/index.js';
import type { ProfileMaterialization } from '../materialization/index.js';
import type { PipelineSourcePackage } from '../source/index.js';
import type { PipelineExecutionPlan, PipelineExecutionPlanOptions } from './contracts.js';
import type { ExecutionPlanDiagnostic } from './diagnostics.js';
import { lowerToExecutionPlan } from './lower-program.js';

export type CompileToExecutionPlanResult =
  | ({ readonly stage: 'compile' } & Extract<PipelineCompileResult, { readonly ok: false }>)
  | {
      readonly stage: 'execution-plan';
      readonly ok: false;
      readonly diagnostics: readonly ExecutionPlanDiagnostic[];
    }
  | ({ readonly stage: 'execution-plan'; readonly executionPlan: PipelineExecutionPlan } & Extract<
      PipelineCompileResult,
      { readonly ok: true }
    >);

export const compileToExecutionPlan = (
  source: PipelineSourcePackage,
  materialization: ProfileMaterialization,
  options: PipelineExecutionPlanOptions,
): CompileToExecutionPlanResult => {
  const compiled = compilePipeline(source, materialization);
  if (!compiled.ok) {
    return Object.freeze({ stage: 'compile', ...compiled });
  }
  const lowered = lowerToExecutionPlan(
    {
      program: compiled.program,
      requirements: compiled.requirements,
      provenance: compiled.provenance,
    },
    options,
  );
  return lowered.ok
    ? Object.freeze({ stage: 'execution-plan', ...compiled, executionPlan: lowered.executionPlan })
    : Object.freeze({ stage: 'execution-plan', ...lowered });
};
