import { Compile } from 'typebox/compile';

import {
  PIPELINE_LIMITS,
  canonicalizeOwnedValue,
  createDiagnosticCollector,
  digestCanonicalBytes,
  normalizeOwnedEnvelope,
  type Digest,
  type PipelineDiagnostic,
} from '../../foundation/index.js';
import { ProgramDigestInputSchema, type ProgramDigestInput } from '../../program/index.js';
import type { LoweredProgram } from '../lowering/index.js';
import { emitProvenance } from './provenance.js';
import { emitRequirements } from './requirements.js';
import { inspectProgramStructure } from './structure.js';

export type BundleEmissionResult =
  | {
      readonly ok: true;
      readonly bundle: ProgramDigestInput;
      readonly programDigest: Digest;
    }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

const bundleValidator = Compile(ProgramDigestInputSchema);

export const emitProgramBundle = (lowered: LoweredProgram): BundleEmissionResult => {
  const collector = createDiagnosticCollector();
  const structure = inspectProgramStructure(lowered.program);
  const emittedRequirements = emitRequirements(
    lowered.requirementUses,
    structure,
    lowered.nodeProvenance,
    collector,
  );
  const provenance = emitProvenance(
    lowered.nodeProvenance,
    emittedRequirements.provenance,
    structure,
    collector,
  );
  const diagnostics = collector.finalize();
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  const owned = normalizeOwnedEnvelope(
    { program: lowered.program, requirements: emittedRequirements.requirements, provenance },
    PIPELINE_LIMITS.sourcePackage.totalActivities,
  );
  if (!owned.ok || !bundleValidator.Check(owned.value)) {
    const failureCollector = createDiagnosticCollector();
    failureCollector.add('CANONICAL_INPUT', owned.ok ? '' : owned.failure.path);
    return { ok: false, diagnostics: failureCollector.finalize() };
  }
  const bundle = owned.value;
  const canonical = canonicalizeOwnedValue(bundle);
  return Object.freeze({
    ok: true,
    bundle,
    programDigest: digestCanonicalBytes('pipeline-program/v1', canonical.bytes),
  });
};
