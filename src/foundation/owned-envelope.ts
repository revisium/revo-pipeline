import { PIPELINE_LIMITS } from './bounds.js';
import {
  normalizeJsonValueWithPolicy,
  type JsonValueTraversalObjectLimit,
  type JsonValueTraversalResult,
} from './json-value-traversal.js';

export type OwnedEnvelopeResult = JsonValueTraversalResult;
export type OwnedEnvelopeObjectLimit = JsonValueTraversalObjectLimit;

// Above the deepest valid source envelope: 32 nested regions plus a depth-16
// ValueSchema or embedded portable value and their closed container fields.
const OWNED_ENVELOPE_MAX_DEPTH = 256;

export const normalizeOwnedEnvelope = (
  input: unknown,
  maximumArrayItems: number,
  objectLimit: OwnedEnvelopeObjectLimit = () => PIPELINE_LIMITS.portableValue.objectKeys,
  maximumVisitedValues: number = PIPELINE_LIMITS.machine.serializedStateJsonValues,
  allowNonNfcObjectKeys = false,
): OwnedEnvelopeResult =>
  normalizeJsonValueWithPolicy(input, {
    maximumDepth: OWNED_ENVELOPE_MAX_DEPTH,
    maximumArrayItems,
    maximumVisitedValues,
    objectLimit,
    boundFailureCode: 'BOUND_EXCEEDED',
    allowNonNfcObjectKeys,
  });
