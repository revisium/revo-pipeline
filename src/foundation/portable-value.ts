import { PIPELINE_LIMITS } from './bounds.js';
import type { JsonPointer } from './json-pointer.js';
import type { JsonValue } from './json-value-contracts.js';
import {
  createJsonValueTraversalSession,
  type JsonValueTraversalResult,
} from './json-value-traversal.js';

export type { JsonScalar, JsonValue, PipelineFailure } from './json-value-contracts.js';

export type PortableValueResult = JsonValueTraversalResult;

export type PortableNormalizationSession = {
  readonly normalize: (input: unknown, path: JsonPointer) => PortableValueResult;
};

export const createPortableNormalizationSession = (): PortableNormalizationSession =>
  createJsonValueTraversalSession({
    maximumDepth: PIPELINE_LIMITS.portableValue.depth,
    maximumArrayItems: PIPELINE_LIMITS.portableValue.arrayItems,
    maximumVisitedValues: PIPELINE_LIMITS.portableValue.visitedValues,
    objectLimit: () => PIPELINE_LIMITS.portableValue.objectKeys,
    boundFailureCode: 'CANONICAL_INPUT',
  });

export const normalizePortableValue = (input: unknown): PortableValueResult =>
  createPortableNormalizationSession().normalize(input, '');

export const isPortableValue = (input: unknown): input is JsonValue =>
  normalizePortableValue(input).ok;
