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
  PipelineDiagnosticSchema,
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
  DIGEST_LEXICAL_PATTERN,
  computeDomainDigest,
  digestCanonicalBytes,
  isDigest,
  type Digest,
  type DigestDomain,
  type DigestResult,
} from './digest.js';
export { computeRedactedDigest } from './digest-redaction.js';
export { isDisplayString, isIdentifier } from './identifier.js';
export { countJsonValues } from './json-values.js';
export {
  ConsensusPolicySchema,
  ParallelBranchClassificationSchema,
  ParallelPolicySchema,
  type ConsensusPolicy,
  type ParallelBranchClassification,
  type ParallelPolicy,
  type RegionExitClassification,
} from './policy.js';
export {
  normalizeOwnedEnvelope,
  type OwnedEnvelopeObjectLimit,
  type OwnedEnvelopeResult,
} from './owned-envelope.js';
export {
  appendJsonPointer,
  escapeJsonPointerToken,
  isCanonicalJsonArrayIndex,
  isJsonPointer,
  JSON_ARRAY_INDEX_PATTERN,
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
export {
  DigestSchema,
  DisplayStringSchema,
  IdentifierSchema,
  JsonPointerSchema,
  JsonScalarSchema,
  JsonValueSchema,
  SafeIntegerSchema,
  atLeastTwoSchema,
  immutableArraySchema,
  nonEmptyArraySchema,
  optionalReadonlySchema,
  readonlySchema,
} from './typebox.js';
export { compareUnicodeCodePoints } from './unicode.js';
export {
  ChoiceDomainSchema,
  EmptyObjectSchema,
  PipelineFailureValueSchema,
  ValueSchemaSchema,
  type ChoiceDomain,
  type ValueSchema,
} from './value-schema/contracts.js';
export {
  casesCoverFiniteDomain,
  finiteDomainOf,
  type FiniteDomain,
} from './value-schema/finite-domain.js';
export {
  compareCanonicalScalars,
  isPipelineFailureSchema,
  normalizeChoiceDomain,
  normalizeValueSchema,
  valueSchemaIsCompatible,
  valueSchemasEqual,
} from './value-schema/normalization.js';
export { projectValueSchema } from './value-schema/pointer.js';
