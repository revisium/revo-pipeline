import { Compile } from 'typebox/compile';

import {
  PIPELINE_LIMITS,
  canonicalizeOwnedValue,
  compareUnicodeCodePoints,
  computeRedactedDigest,
  digestCanonicalBytes,
  normalizeOwnedEnvelope,
  valueSchemasEqual,
  type Digest,
} from '../foundation/index.js';
import {
  admitSchemaValidatedPipelineProgram,
  type ProgramAdmissionReceipt,
} from './admission/index.js';
import {
  ProgramDigestInputSchema,
  type ProgramDigestInput,
  type ProgramNodeId,
} from './contracts/index.js';

const bundleValidator = Compile(ProgramDigestInputSchema);

export type AdmittedProgramDigestInput = {
  readonly value: ProgramDigestInput;
  readonly digest: Digest;
  readonly receipt: ProgramAdmissionReceipt;
};

const isStrictlySortedBy = <Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (
      previous === undefined ||
      current === undefined ||
      compareUnicodeCodePoints(key(previous), key(current)) >= 0
    ) {
      return false;
    }
  }
  return true;
};

const hasValidCrossReferences = (
  input: ProgramDigestInput,
  regions: ReadonlyMap<string, ProgramDigestInput['program']['modules'][number]['region']>,
): boolean => {
  if (!isStrictlySortedBy(input.requirements.entries, ({ key }) => key)) {
    return false;
  }
  const requirements = new Map(input.requirements.entries.map((entry) => [entry.key, entry]));
  const usedRequirements = new Set<string>();
  const structuralIds = new Set<ProgramNodeId>();
  for (const region of regions.values()) {
    structuralIds.add(region.id);
    for (const node of region.nodes) {
      structuralIds.add(node.id);
      if (node.kind === 'activity') {
        const requirement = requirements.get(node.requirementKey);
        if (
          requirement?.kind !== node.activityKind ||
          !valueSchemasEqual(node.inputSchema, requirement.inputSchema) ||
          !valueSchemasEqual(node.outputSchema, requirement.outputSchema)
        ) {
          return false;
        }
        usedRequirements.add(node.requirementKey);
      }
    }
  }
  if (usedRequirements.size !== requirements.size) {
    return false;
  }
  if (!isStrictlySortedBy(input.provenance.nodes, ({ programNodeId }) => programNodeId)) {
    return false;
  }
  const provenanceIds = new Set(input.provenance.nodes.map(({ programNodeId }) => programNodeId));
  if (
    provenanceIds.size !== structuralIds.size ||
    [...structuralIds].some((id) => !provenanceIds.has(id))
  ) {
    return false;
  }
  if (
    !isStrictlySortedBy(input.provenance.requirements, ({ requirementKey }) => requirementKey) ||
    input.provenance.requirements.length !== requirements.size
  ) {
    return false;
  }
  return input.provenance.requirements.every(
    (record) =>
      requirements.has(record.requirementKey) &&
      isStrictlySortedBy(record.sourcePaths, (path) => path) &&
      isStrictlySortedBy(record.materializationPaths, (path) => path),
  );
};

export const admitSchemaValidatedProgramDigestInput = (
  input: ProgramDigestInput,
  receipt: ProgramAdmissionReceipt,
): AdmittedProgramDigestInput | null => {
  if (input.program !== receipt.program || !hasValidCrossReferences(input, receipt.index.regions)) {
    return null;
  }
  const canonical = canonicalizeOwnedValue(input);
  return Object.freeze({
    value: input,
    digest: digestCanonicalBytes('pipeline-program/v1', canonical.bytes),
    receipt,
  });
};

export const admitOwnedProgramDigestInput = (
  input: ProgramDigestInput,
  receipt: ProgramAdmissionReceipt,
): AdmittedProgramDigestInput | null =>
  bundleValidator.Check(input) ? admitSchemaValidatedProgramDigestInput(input, receipt) : null;

export const admitProgramDigestInput = (input: unknown): AdmittedProgramDigestInput | null => {
  const owned = normalizeOwnedEnvelope(
    input,
    PIPELINE_LIMITS.machine.liveFrames,
    undefined,
    PIPELINE_LIMITS.machine.serializedStateJsonValues,
  );
  if (!owned.ok || !bundleValidator.Check(owned.value)) {
    return null;
  }
  const admission = admitSchemaValidatedPipelineProgram(owned.value.program);
  if (!admission.ok) {
    return null;
  }
  return admitSchemaValidatedProgramDigestInput(owned.value, admission.receipt);
};

export const computeProgramDigest = (value: ProgramDigestInput): Digest =>
  computeRedactedDigest(() => admitProgramDigestInput(value)?.digest ?? null);
