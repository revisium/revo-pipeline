import { Type } from 'typebox';

import { PIPELINE_LIMITS } from './bounds.js';
import { isJsonPointer, type JsonPointer } from './json-pointer.js';
import { closedObject, JsonPointerSchema, readonlySchema } from './typebox.js';
import { compareUnicodeCodePoints } from './unicode.js';

export type PipelineDiagnosticFamily =
  | 'SOURCE'
  | 'MATERIALIZATION'
  | 'LINK'
  | 'DATA'
  | 'BOUND'
  | 'REQUIREMENT'
  | 'LOWERING'
  | 'CANONICAL';

export type PipelineDiagnostic = {
  readonly family: PipelineDiagnosticFamily;
  readonly code: PipelineDiagnosticCode;
  readonly path: JsonPointer;
  readonly message: string;
};

type PipelineDiagnosticDefinition = {
  readonly family: PipelineDiagnosticFamily;
  readonly code: string;
  readonly message: string;
};

const definition = (
  family: PipelineDiagnosticFamily,
  code: string,
  message: string,
): PipelineDiagnosticDefinition => Object.freeze({ family, code, message });

export const PIPELINE_DIAGNOSTIC_CATALOG = Object.freeze({
  SOURCE_DIAGNOSTIC_LIMIT: definition(
    'SOURCE',
    'SOURCE_DIAGNOSTIC_LIMIT',
    'The diagnostic limit was exceeded.',
  ),
  SOURCE_GATE_ANSWER_BIJECTION: definition(
    'SOURCE',
    'SOURCE_GATE_ANSWER_BIJECTION',
    'The human-gate answers and routes do not form an exact bijection.',
  ),
  SOURCE_NODE_ID_DUPLICATE: definition(
    'SOURCE',
    'SOURCE_NODE_ID_DUPLICATE',
    'A source node identifier is duplicated.',
  ),
  MATERIALIZATION_POLICY_COUNT: definition(
    'MATERIALIZATION',
    'MATERIALIZATION_POLICY_COUNT',
    'The materialized participant count does not satisfy the source policy.',
  ),
  MATERIALIZATION_SELECTION_INVALID: definition(
    'MATERIALIZATION',
    'MATERIALIZATION_SELECTION_INVALID',
    'The agent-slot selection is invalid.',
  ),
  MATERIALIZATION_SLOT_MISSING: definition(
    'MATERIALIZATION',
    'MATERIALIZATION_SLOT_MISSING',
    'A reachable agent slot has no selection.',
  ),
  MATERIALIZATION_SLOT_EXTRA: definition(
    'MATERIALIZATION',
    'MATERIALIZATION_SLOT_EXTRA',
    'A selection does not identify a reachable agent slot.',
  ),
  MATERIALIZATION_STRATEGY_UNAVAILABLE: definition(
    'MATERIALIZATION',
    'MATERIALIZATION_STRATEGY_UNAVAILABLE',
    'The selected strategy is not allowed by the source agent slot.',
  ),
  MATERIALIZATION_PARTICIPANT_DUPLICATE: definition(
    'MATERIALIZATION',
    'MATERIALIZATION_PARTICIPANT_DUPLICATE',
    'A participant key is duplicated within the selection.',
  ),
  LINK_MODULE_MISSING: definition('LINK', 'LINK_MODULE_MISSING', 'A called module is missing.'),
  LINK_MODULE_OUTCOME_MISMATCH: definition(
    'LINK',
    'LINK_MODULE_OUTCOME_MISMATCH',
    'The call outcome routes do not match the called module outcomes.',
  ),
  LINK_RECURSION: definition('LINK', 'LINK_RECURSION', 'The module call graph is recursive.'),
  DATA_DOMINANCE: definition('DATA', 'DATA_DOMINANCE', 'A data reference is not dominated.'),
  DATA_FAILED_EXIT_SCHEMA: definition(
    'DATA',
    'DATA_FAILED_EXIT_SCHEMA',
    'A failed exit does not use the exact pipeline failure schema.',
  ),
  DATA_POINTER_MISSING: definition(
    'DATA',
    'DATA_POINTER_MISSING',
    'A runtime JSON Pointer target is missing.',
  ),
  DATA_POINTER_STATIC: definition(
    'DATA',
    'DATA_POINTER_STATIC',
    'A static JSON Pointer target is invalid.',
  ),
  DATA_SCHEMA_INCOMPATIBLE: definition(
    'DATA',
    'DATA_SCHEMA_INCOMPATIBLE',
    'The producer and consumer schemas are incompatible.',
  ),
  DATA_SCHEMA_MISMATCH: definition(
    'DATA',
    'DATA_SCHEMA_MISMATCH',
    'The mapped value does not satisfy its schema.',
  ),
  DATA_SCOPE: definition('DATA', 'DATA_SCOPE', 'A data reference escapes its valid scope.'),
  BOUND_EXCEEDED: definition('BOUND', 'BOUND_EXCEEDED', 'A declared pipeline bound was exceeded.'),
  BOUND_OVERFLOW: definition('BOUND', 'BOUND_OVERFLOW', 'A composed pipeline bound overflowed.'),
  REQUIREMENT_CONFLICT: definition(
    'REQUIREMENT',
    'REQUIREMENT_CONFLICT',
    'Requirement declarations conflict.',
  ),
  REQUIREMENT_MISSING: definition(
    'REQUIREMENT',
    'REQUIREMENT_MISSING',
    'A required declaration is missing.',
  ),
  REQUIREMENT_UNUSED: definition(
    'REQUIREMENT',
    'REQUIREMENT_UNUSED',
    'A requirement declaration is unused.',
  ),
  LOWERING_ID_COLLISION: definition(
    'LOWERING',
    'LOWERING_ID_COLLISION',
    'Deterministic lowering produced a duplicate identifier.',
  ),
  CANONICAL_INPUT: definition('CANONICAL', 'CANONICAL_INPUT', 'The canonical input is invalid.'),
});

export type PipelineDiagnosticCode = keyof typeof PIPELINE_DIAGNOSTIC_CATALOG;

export const PipelineDiagnosticSchema = Type.Unsafe<PipelineDiagnostic>(
  Type.Union(
    Object.values(PIPELINE_DIAGNOSTIC_CATALOG).map((diagnostic) =>
      closedObject({
        family: readonlySchema(Type.Literal(diagnostic.family)),
        code: readonlySchema(Type.Literal(diagnostic.code)),
        path: readonlySchema(JsonPointerSchema),
        message: readonlySchema(Type.Literal(diagnostic.message)),
      }),
    ),
  ),
);

const familyPriority: Readonly<Record<PipelineDiagnosticFamily, number>> = Object.freeze({
  SOURCE: 0,
  MATERIALIZATION: 1,
  LINK: 2,
  DATA: 3,
  BOUND: 4,
  REQUIREMENT: 5,
  LOWERING: 6,
  CANONICAL: 7,
});

const invalidDiagnostic = (): never => {
  throw new TypeError('Invalid pipeline diagnostic input.');
};

const isDiagnosticPath = (value: unknown): value is JsonPointer => {
  if (isJsonPointer(value)) {
    return true;
  }
  return (
    typeof value === 'string' &&
    (value === '' || value.startsWith('/')) &&
    !/~(?![01])/u.test(value)
  );
};

const isDiagnosticCode = (value: unknown): value is PipelineDiagnosticCode =>
  typeof value === 'string' && Object.hasOwn(PIPELINE_DIAGNOSTIC_CATALOG, value);

const capturePipelineDiagnostic = (value: unknown): PipelineDiagnostic | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const prototype = Reflect.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== 4 ||
    !['family', 'code', 'path', 'message'].every((key) => keys.includes(key))
  ) {
    return null;
  }
  const codeDescriptor = Reflect.getOwnPropertyDescriptor(value, 'code');
  const pathDescriptor = Reflect.getOwnPropertyDescriptor(value, 'path');
  const familyDescriptor = Reflect.getOwnPropertyDescriptor(value, 'family');
  const messageDescriptor = Reflect.getOwnPropertyDescriptor(value, 'message');
  if (
    !codeDescriptor?.enumerable ||
    !('value' in codeDescriptor) ||
    !pathDescriptor?.enumerable ||
    !('value' in pathDescriptor) ||
    !familyDescriptor?.enumerable ||
    !('value' in familyDescriptor) ||
    !messageDescriptor?.enumerable ||
    !('value' in messageDescriptor)
  ) {
    return null;
  }
  const code: unknown = codeDescriptor.value;
  const path: unknown = pathDescriptor.value;
  if (!isDiagnosticCode(code) || !isDiagnosticPath(path)) {
    return null;
  }
  const catalogEntry = PIPELINE_DIAGNOSTIC_CATALOG[code];
  if (
    familyDescriptor.value !== catalogEntry.family ||
    messageDescriptor.value !== catalogEntry.message
  ) {
    return null;
  }
  return Object.freeze({
    family: catalogEntry.family,
    code,
    path,
    message: catalogEntry.message,
  });
};

export const createPipelineDiagnostic = (
  code: PipelineDiagnosticCode,
  path: JsonPointer,
): PipelineDiagnostic => {
  if (!isDiagnosticCode(code) || !isDiagnosticPath(path)) {
    return invalidDiagnostic();
  }
  const catalogEntry = PIPELINE_DIAGNOSTIC_CATALOG[code];
  return Object.freeze({
    family: catalogEntry.family,
    code,
    path,
    message: catalogEntry.message,
  });
};

const compareCapturedPipelineDiagnostics = (
  left: PipelineDiagnostic,
  right: PipelineDiagnostic,
): number =>
  familyPriority[left.family] - familyPriority[right.family] ||
  compareUnicodeCodePoints(left.path, right.path) ||
  compareUnicodeCodePoints(left.code, right.code);

const captureComparatorInput = (value: unknown): PipelineDiagnostic => {
  try {
    return capturePipelineDiagnostic(value) ?? invalidDiagnostic();
  } catch {
    return invalidDiagnostic();
  }
};

export const comparePipelineDiagnostics = (
  left: PipelineDiagnostic,
  right: PipelineDiagnostic,
): number =>
  compareCapturedPipelineDiagnostics(captureComparatorInput(left), captureComparatorInput(right));

const copyDiagnosticList = (input: readonly PipelineDiagnostic[]): PipelineDiagnostic[] => {
  try {
    if (!Array.isArray(input) || Reflect.getPrototypeOf(input) !== Array.prototype) {
      return invalidDiagnostic();
    }
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(input, 'length');
    if (!lengthDescriptor || !('value' in lengthDescriptor)) {
      return invalidDiagnostic();
    }
    const length: unknown = lengthDescriptor.value;
    const keys = Reflect.ownKeys(input);
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      keys.length !== length + 1 ||
      keys.some((key) => typeof key !== 'string')
    ) {
      return invalidDiagnostic();
    }

    const copy: PipelineDiagnostic[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return invalidDiagnostic();
      }
      const diagnostic = capturePipelineDiagnostic(descriptor.value);
      if (diagnostic === null) {
        return invalidDiagnostic();
      }
      copy.push(diagnostic);
    }
    return copy;
  } catch {
    return invalidDiagnostic();
  }
};

export const finalizePipelineDiagnostics = (
  diagnostics: readonly PipelineDiagnostic[],
): readonly PipelineDiagnostic[] => {
  const ordered = copyDiagnosticList(diagnostics).sort(compareCapturedPipelineDiagnostics);
  if (ordered.length <= PIPELINE_LIMITS.diagnostics) {
    return Object.freeze(ordered);
  }
  return Object.freeze([
    ...ordered.slice(0, PIPELINE_LIMITS.diagnostics - 1),
    createPipelineDiagnostic('SOURCE_DIAGNOSTIC_LIMIT', ''),
  ]);
};
