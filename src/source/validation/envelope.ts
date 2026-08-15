import type { TUnsafe } from 'typebox';
import { Compile, type Validator } from 'typebox/compile';
import type { TLocalizedValidationError } from 'typebox/error';

import {
  PIPELINE_LIMITS,
  createDiagnosticCollector,
  normalizeOwnedEnvelope,
  type JsonValue,
  type PipelineDiagnostic,
} from '../../foundation/index.js';
import { selectSchemaFailure, type EnvelopeSchemaFailureMapper } from './schema-error-selection.js';

export type EnvelopeValidationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

export type EnvelopeValidator<Value> = (input: unknown) => EnvelopeValidationResult<Value>;

export type EnvelopeValidatorOptions<Value> = {
  readonly schema: TUnsafe<Value>;
  readonly mapFailure?: EnvelopeSchemaFailureMapper;
  readonly knownDiscriminators?: readonly string[];
};

export const createEnvelopeValidator = <Value>({
  schema,
  mapFailure,
  knownDiscriminators = [],
}: EnvelopeValidatorOptions<Value>): EnvelopeValidator<Value> => {
  const validator: Validator<Record<string, never>, TUnsafe<Value>> = Compile(schema);
  const discriminatorSet = new Set(knownDiscriminators);
  const matchesSchema = (value: JsonValue): value is JsonValue & Value => validator.Check(value);

  return (input: unknown): EnvelopeValidationResult<Value> => {
    const collector = createDiagnosticCollector();
    const envelope = normalizeOwnedEnvelope(
      input,
      PIPELINE_LIMITS.sourcePackage.nodes,
      undefined,
      PIPELINE_LIMITS.machine.serializedStateJsonValues,
    );
    if (!envelope.ok) {
      collector.add(
        envelope.failure.code === 'BOUND_EXCEEDED' ? 'BOUND_EXCEEDED' : 'CANONICAL_INPUT',
        envelope.failure.path,
      );
      return { ok: false, diagnostics: collector.finalize() };
    }
    try {
      if (matchesSchema(envelope.value)) {
        return { ok: true, value: envelope.value };
      }
    } catch {
      collector.add('CANONICAL_INPUT', '');
      return { ok: false, diagnostics: collector.finalize() };
    }

    let errors: readonly TLocalizedValidationError[];
    try {
      errors = validator.Errors(envelope.value);
    } catch {
      collector.add('CANONICAL_INPUT', '');
      return { ok: false, diagnostics: collector.finalize() };
    }
    const failure = selectSchemaFailure(errors, envelope.value, discriminatorSet, mapFailure);
    collector.add(failure.code, failure.path);
    return { ok: false, diagnostics: collector.finalize() };
  };
};
