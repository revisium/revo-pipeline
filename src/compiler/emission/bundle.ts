import {
  createDiagnosticCollector,
  type Digest,
  type PipelineDiagnostic,
} from '../../foundation/index.js';
import {
  admitOwnedProgramDigestInput,
  type ProgramAdmissionReceipt,
  type ProgramDigestInput,
} from '../../program/index.js';
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

export const emitProgramBundle = (
  lowered: LoweredProgram,
  receipt: ProgramAdmissionReceipt,
): BundleEmissionResult => {
  const collector = createDiagnosticCollector();
  const structure = inspectProgramStructure(receipt);
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

  const bundle = Object.freeze({
    program: lowered.program,
    requirements: emittedRequirements.requirements,
    provenance,
  });
  const admitted = admitOwnedProgramDigestInput(bundle, receipt);
  if (admitted === null) {
    const failureCollector = createDiagnosticCollector();
    failureCollector.add('CANONICAL_INPUT', '');
    return { ok: false, diagnostics: failureCollector.finalize() };
  }
  return Object.freeze({
    ok: true,
    bundle: admitted.value,
    programDigest: admitted.digest,
  });
};
