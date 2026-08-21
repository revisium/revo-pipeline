import {
  PIPELINE_LIMITS,
  compareUnicodeCodePoints,
  type JsonPointer,
} from '../foundation/index.js';

const messages = {
  EXECUTION_PLAN_BINDINGS_UNSUPPORTED:
    'The execution-plan slice does not support executor bindings.',
  EXECUTION_PLAN_CHOICE_DEFAULT_REQUIRED:
    'The execution-plan choice requires an explicit default route.',
  EXECUTION_PLAN_CHOICE_VALUE_UNSUPPORTED:
    'The execution-plan choice value is not a supported run identifier.',
  EXECUTION_PLAN_CONTRACT_INVALID:
    'The lowered execution plan does not satisfy the execution-plan contract.',
  EXECUTION_PLAN_DEPTH_EXCEEDED:
    'The lowered execution plan exceeds the configured node nesting depth.',
  EXECUTION_PLAN_GRAPH_UNSUPPORTED:
    'The Program control-flow graph is not supported by this execution-plan slice.',
  EXECUTION_PLAN_IDENTITY_INVALID:
    'A Program identity cannot be converted to a stable run identifier.',
  EXECUTION_PLAN_MODULES_UNSUPPORTED:
    'The execution-plan slice supports exactly one Program module.',
  EXECUTION_PLAN_NODE_UNSUPPORTED:
    'The Program node kind is not supported by this execution-plan slice.',
  EXECUTION_PLAN_OUTCOME_UNSUPPORTED: 'The Program outcome is not a supported run identifier.',
  EXECUTION_PLAN_OUTPUT_KEY_UNSUPPORTED:
    'The Program output key is not a supported run identifier.',
  EXECUTION_PLAN_SELECTOR_UNSUPPORTED:
    'The Program selector is not supported by this execution-plan slice.',
} as const;

export type ExecutionPlanDiagnosticCode = keyof typeof messages;

export type ExecutionPlanDiagnostic = {
  readonly family: 'EXECUTION_PLAN';
  readonly code: ExecutionPlanDiagnosticCode;
  readonly path: JsonPointer;
  readonly message: (typeof messages)[ExecutionPlanDiagnosticCode];
};

export const executionPlanDiagnostic = (
  code: ExecutionPlanDiagnosticCode,
  path: JsonPointer,
): ExecutionPlanDiagnostic =>
  Object.freeze({ family: 'EXECUTION_PLAN', code, path, message: messages[code] });

export const finalizeExecutionPlanDiagnostics = (
  diagnostics: readonly ExecutionPlanDiagnostic[],
): readonly ExecutionPlanDiagnostic[] => {
  const unique = new Map(
    diagnostics.map((diagnostic) => [`${diagnostic.path}\n${diagnostic.code}`, diagnostic]),
  );
  return Object.freeze(
    [...unique.values()]
      .toSorted((left, right) => {
        const path = compareUnicodeCodePoints(left.path, right.path);
        return path === 0 ? compareUnicodeCodePoints(left.code, right.code) : path;
      })
      .slice(0, PIPELINE_LIMITS.diagnostics),
  );
};
