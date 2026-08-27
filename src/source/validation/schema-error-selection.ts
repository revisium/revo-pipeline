import type { TLocalizedValidationError } from 'typebox/error';

import {
  appendJsonPointer,
  isJsonPointer,
  readJsonPointer,
  type JsonPointer,
  type JsonValue,
  type PipelineDiagnosticCode,
} from '../../foundation/index.js';

export type EnvelopeSchemaFailure = {
  readonly code: PipelineDiagnosticCode;
  readonly path: JsonPointer;
};

export type EnvelopeSchemaFailureMapper = (
  keyword: string,
  path: JsonPointer,
) => EnvelopeSchemaFailure | null;

const discriminatorFields = new Set(['kind', 'schemaVersion', 'strategy', 'type']);

const asPointer = (value: string): JsonPointer => (isJsonPointer(value) ? value : '');

const requiredPath = (error: TLocalizedValidationError): JsonPointer => {
  const path = asPointer(error.instancePath);
  if (error.keyword !== 'required') {
    return path;
  }
  const [property] = error.params.requiredProperties;
  return property === undefined ? path : appendJsonPointer(path, property);
};

const additionalPropertyPath = (error: TLocalizedValidationError): JsonPointer => {
  const path = asPointer(error.instancePath);
  if (error.keyword !== 'additionalProperties') {
    return path;
  }
  const [property] = error.params.additionalProperties;
  return property === undefined ? path : appendJsonPointer(path, property);
};

const isBoundError = (error: TLocalizedValidationError): boolean =>
  ['maximum', 'minimum', 'maxItems', 'minItems', 'maxProperties', 'minProperties'].includes(
    error.keyword,
  );

const discriminatorField = (error: TLocalizedValidationError): string | null => {
  const path = asPointer(error.instancePath);
  const finalToken = path.split('/').at(-1) ?? '';
  return discriminatorFields.has(finalToken) ? finalToken : null;
};

const rejectedUnionBranches = (
  errors: readonly TLocalizedValidationError[],
  input: JsonValue,
  knownDiscriminators: ReadonlySet<string>,
): ReadonlySet<string> => {
  const rejected = new Set<string>();
  for (const error of errors) {
    if (error.keyword !== 'const') {
      continue;
    }
    const field = discriminatorField(error);
    if (field === null) {
      continue;
    }
    const path = asPointer(error.instancePath);
    const lookup = readJsonPointer(input, path);
    if (
      !lookup.found ||
      typeof lookup.value !== 'string' ||
      !knownDiscriminators.has(lookup.value)
    ) {
      continue;
    }
    const marker = `/properties/${field}`;
    const markerIndex = error.schemaPath.lastIndexOf(marker);
    if (markerIndex > 1) {
      rejected.add(error.schemaPath.slice(0, markerIndex));
    }
  }
  return rejected;
};

const belongsToRejectedBranch = (
  error: TLocalizedValidationError,
  rejected: ReadonlySet<string>,
): boolean => {
  for (const prefix of rejected) {
    if (error.schemaPath === prefix || error.schemaPath.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
};

const isIrrelevantUnionConst = (
  error: TLocalizedValidationError,
  input: JsonValue,
  knownDiscriminators: ReadonlySet<string>,
): boolean => {
  if (error.keyword !== 'const' || discriminatorField(error) === null) {
    return false;
  }
  const lookup = readJsonPointer(input, asPointer(error.instancePath));
  return lookup.found && typeof lookup.value === 'string' && knownDiscriminators.has(lookup.value);
};

const chooseSchemaError = (
  errors: readonly TLocalizedValidationError[],
  input: JsonValue,
  knownDiscriminators: ReadonlySet<string>,
): TLocalizedValidationError | undefined => {
  const rejected = rejectedUnionBranches(errors, input, knownDiscriminators);
  const relevant = errors.filter(
    (error) =>
      !belongsToRejectedBranch(error, rejected) &&
      !isIrrelevantUnionConst(error, input, knownDiscriminators) &&
      error.keyword !== 'anyOf',
  );
  return (
    relevant.find((error) => error.keyword === 'const' && discriminatorField(error) !== null) ??
    relevant.find((error) => error.keyword === 'pattern') ??
    relevant.find(
      (error) => error.keyword === 'required' && error.params.requiredProperties.includes('kind'),
    ) ??
    relevant.find((error) => error.keyword === 'required') ??
    relevant.find((error) => error.keyword === 'additionalProperties') ??
    relevant[0] ??
    errors[0]
  );
};

export const selectSchemaFailure = (
  errors: readonly TLocalizedValidationError[],
  input: JsonValue,
  knownDiscriminators: ReadonlySet<string>,
  mapFailure?: EnvelopeSchemaFailureMapper,
): EnvelopeSchemaFailure => {
  const error = chooseSchemaError(errors, input, knownDiscriminators);
  if (error === undefined) {
    return { code: 'CANONICAL_INPUT', path: '' };
  }
  const path =
    error.keyword === 'additionalProperties' ? additionalPropertyPath(error) : requiredPath(error);
  const fallback: EnvelopeSchemaFailure = {
    code: isBoundError(error) ? 'BOUND_EXCEEDED' : 'CANONICAL_INPUT',
    path,
  };
  return mapFailure?.(error.keyword, path) ?? fallback;
};
