export {
  PIPELINE_LIMITS,
  addWithinLimit,
  isSafeIntegerInRange,
  multiplyWithinLimit,
} from './bounds.js';
export {
  canonicalizeOwnedValue,
  canonicalizePortableValue,
  type CanonicalizedOwnedValue,
  type CanonicalizationResult,
  type CanonicalizedValue,
} from './canonicalization.js';
export {
  PIPELINE_DIAGNOSTIC_CATALOG,
  comparePipelineDiagnostics,
  createPipelineDiagnostic,
  finalizePipelineDiagnostics,
  type PipelineDiagnosticCode,
  type PipelineDiagnostic,
  type PipelineDiagnosticFamily,
} from './diagnostics.js';
export { createDiagnosticCollector, type DiagnosticCollector } from './diagnostic-collector.js';
export {
  DIGEST_DOMAINS,
  computeDomainDigest,
  digestCanonicalBytes,
  isDigest,
  type Digest,
  type DigestDomain,
  type DigestResult,
} from './digest.js';
export { isDisplayString, isIdentifier } from './identifier.js';
export { normalizeOwnedEnvelope, type OwnedEnvelopeResult } from './owned-envelope.js';
export {
  appendJsonPointer,
  escapeJsonPointerToken,
  isJsonPointer,
  parseJsonPointer,
  readJsonPointer,
  unescapeJsonPointerToken,
  type JsonPointer,
  type JsonPointerLookup,
} from './json-pointer.js';
export {
  createPortableNormalizationSession,
  isPortableValue,
  normalizePortableValue,
  type JsonScalar,
  type JsonValue,
  type PipelineFailure,
  type PortableNormalizationSession,
  type PortableValueResult,
} from './portable-value.js';
export { closedObject, type ClosedObjectOptions } from './schema.js';
export { compareUnicodeCodePoints } from './unicode.js';
