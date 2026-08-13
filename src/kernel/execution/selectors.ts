import { Check } from 'typebox/value';

import {
  compareCanonicalScalars,
  compareUnicodeCodePoints,
  isPortableValue,
  readJsonPointer,
  type JsonPointer,
  type JsonScalar,
  type JsonValue,
  type ValueSchema,
} from '../../foundation/index.js';
import type { ProgramValueMapping, ProgramValueSelector } from '../../program/index.js';
import type { NodeTerminalResult } from '../contracts/results.js';

export type SelectorEnvironment = {
  readonly moduleInput: JsonValue;
  readonly scopeInput: JsonValue;
  readonly nodeResults: Readonly<Record<string, NodeTerminalResult>>;
  readonly regionOutput?: JsonValue;
  readonly repeat?: {
    readonly iteration: number;
    readonly previousOutput: JsonValue;
  };
  readonly map?: {
    readonly item: JsonValue;
    readonly itemKey: string;
  };
};

export type ValueResolution =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly path: JsonPointer };

const selectNodeResult = (
  selector: Extract<ProgramValueSelector, { readonly kind: 'nodeOutput' | 'nodeFailure' }>,
  environment: SelectorEnvironment,
): JsonValue | undefined => {
  const result = environment.nodeResults[selector.nodeId];
  if (selector.kind === 'nodeOutput' && result?.status === 'succeeded') {
    return result.output;
  }
  if (selector.kind === 'nodeFailure' && result?.status === 'failed') {
    return result.failure;
  }
  return undefined;
};

const selectorBase = (
  selector: ProgramValueSelector,
  environment: SelectorEnvironment,
): JsonValue | undefined => {
  switch (selector.kind) {
    case 'literal':
      return selector.value;
    case 'moduleInput':
      return environment.moduleInput;
    case 'scopeInput':
      return environment.scopeInput;
    case 'nodeOutput':
    case 'nodeFailure':
      return selectNodeResult(selector, environment);
    case 'regionOutput':
      return environment.regionOutput;
    case 'repeat':
      return selector.value === 'iteration'
        ? environment.repeat?.iteration
        : environment.repeat?.previousOutput;
    case 'map':
      return selector.value === 'item' ? environment.map?.item : environment.map?.itemKey;
  }
  return undefined;
};

export const resolveSelector = (
  selector: ProgramValueSelector,
  environment: SelectorEnvironment,
): ValueResolution => {
  const base = selectorBase(selector, environment);
  const pointer = 'pointer' in selector ? selector.pointer : '';
  if (base === undefined) {
    return Object.freeze({ ok: false, path: pointer });
  }
  const result = readJsonPointer(base, pointer);
  return result.found && isPortableValue(result.value)
    ? Object.freeze({ ok: true, value: result.value })
    : Object.freeze({ ok: false, path: pointer });
};

export const resolveMapping = (
  mapping: ProgramValueMapping,
  environment: SelectorEnvironment,
): ValueResolution => {
  const output: Record<string, JsonValue> = {};
  const entries = Object.entries(mapping).sort(([left], [right]) =>
    compareUnicodeCodePoints(left, right),
  );
  for (const [key, selector] of entries) {
    const result = resolveSelector(selector, environment);
    if (!result.ok) {
      return result;
    }
    output[key] = result.value;
  }
  return Object.freeze({ ok: true, value: Object.freeze(output) });
};

export const valueMatchesSchema = (schema: ValueSchema, value: JsonValue): boolean => {
  try {
    return Check(schema, value);
  } catch {
    return false;
  }
};

const scalarKey = (value: JsonScalar): string =>
  value === null ? 'null' : `${typeof value}:${JSON.stringify(value)}`;

export const choiceMatches = (
  value: JsonValue,
  domain:
    | { readonly kind: 'equals'; readonly value: JsonScalar }
    | {
        readonly kind: 'oneOf';
        readonly values: readonly JsonScalar[];
      },
): boolean => {
  if (typeof value === 'object' && value !== null) {
    return false;
  }
  const scalar = value;
  return domain.kind === 'equals'
    ? scalarKey(scalar) === scalarKey(domain.value)
    : domain.values.some((candidate) => compareCanonicalScalars(scalar, candidate) === 0);
};
