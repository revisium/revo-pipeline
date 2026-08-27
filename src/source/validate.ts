import {
  canonicalizeOwnedValue,
  createDiagnosticCollector,
  digestCanonicalBytes,
  type Digest,
  type PipelineDiagnostic,
} from '../foundation/index.js';
import { PipelineSourcePackageSchema, type PipelineSourcePackage } from './contracts/index.js';
import { normalizeSourcePackage } from './normalization/index.js';
import {
  validateSourceNodeIds,
  validateSourceSemantics,
  type ReachableAgentSlot,
} from './semantics/index.js';
import { createEnvelopeValidator } from './validation/envelope.js';

export type ValidatedPipelineSource = {
  readonly source: PipelineSourcePackage;
  readonly sourceDigest: Digest;
  readonly canonicalText: string;
  readonly reachableAgents: readonly ReachableAgentSlot[];
};

export type PipelineSourceValidationResult =
  | { readonly ok: true; readonly value: ValidatedPipelineSource }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

const validateEnvelope = createEnvelopeValidator<PipelineSourcePackage>({
  schema: PipelineSourcePackageSchema,
  knownDiscriminators: [
    'pipeline-source/v1',
    'null',
    'boolean',
    'integer',
    'number',
    'string',
    'array',
    'object',
    'literal',
    'moduleInput',
    'scopeInput',
    'nodeOutput',
    'nodeFailure',
    'regionOutput',
    'repeat',
    'map',
    'equals',
    'oneOf',
    'exists',
    'all',
    'any',
    'not',
    'agent',
    'script',
    'choice',
    'parallel',
    'wait',
    'humanGate',
    'consensus',
    'call',
    'end',
    'single',
    'unanimous',
    'quorum',
    'independentThreshold',
    'threshold',
    'duration',
    'signal',
    'collect',
    'failFast',
  ],
});

export const validatePipelineSource = (input: unknown): PipelineSourceValidationResult => {
  const envelope = validateEnvelope(input);
  if (!envelope.ok) {
    return envelope;
  }
  const collector = createDiagnosticCollector();
  const source = normalizeSourcePackage(envelope.value, collector);
  const sourceNodeIdsAreUnique = validateSourceNodeIds(source, collector);
  const reachableAgents = sourceNodeIdsAreUnique ? validateSourceSemantics(source, collector) : [];
  const diagnostics = collector.finalize();
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  const canonical = canonicalizeOwnedValue(source);
  return {
    ok: true,
    value: Object.freeze({
      source,
      sourceDigest: digestCanonicalBytes('pipeline-source/v1', canonical.bytes),
      canonicalText: canonical.text,
      reachableAgents,
    }),
  };
};
