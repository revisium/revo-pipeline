import {
  compareUnicodeCodePoints,
  createDiagnosticCollector,
  isCanonicalJsonArrayIndex,
  parseJsonPointer,
  type JsonPointer,
  type PipelineDiagnostic,
} from '../../foundation/index.js';
import {
  admitOwnedPipelineProgram,
  type NodeProvenance,
  type ProgramAdmissionReceipt,
  type ProgramAdmissionViolation,
  type ProgramAnalysis,
} from '../../program/index.js';
import type { LoweredProgram } from '../lowering/index.js';

export type LoweredProgramAdmission =
  | { readonly ok: true; readonly receipt: ProgramAdmissionReceipt }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

const compareSourcePaths = (left: JsonPointer, right: JsonPointer): number => {
  const leftTokens = parseJsonPointer(left) ?? [];
  const rightTokens = parseJsonPointer(right) ?? [];
  for (let index = 0; index < Math.min(leftTokens.length, rightTokens.length); index += 1) {
    const leftToken = leftTokens[index] ?? '';
    const rightToken = rightTokens[index] ?? '';
    const order =
      isCanonicalJsonArrayIndex(leftToken) && isCanonicalJsonArrayIndex(rightToken)
        ? Number(leftToken) - Number(rightToken)
        : compareUnicodeCodePoints(leftToken, rightToken);
    if (order !== 0) {
      return order;
    }
  }
  return leftTokens.length - rightTokens.length;
};

const compareProvenance = (left: NodeProvenance, right: NodeProvenance): number =>
  compareSourcePaths(left.sourcePath, right.sourcePath) ||
  compareUnicodeCodePoints(left.loweringRole, right.loweringRole) ||
  left.ordinal - right.ordinal ||
  compareUnicodeCodePoints(left.programNodeId, right.programNodeId);

const crossingPath = (
  records: readonly NodeProvenance[],
  maximum: number,
  contributes: (record: NodeProvenance) => number,
): JsonPointer => {
  let total = 0;
  for (const record of records) {
    total += contributes(record);
    if (total > maximum) {
      return record.sourcePath;
    }
  }
  return '';
};

const violationPath = (
  violation: ProgramAdmissionViolation,
  analysis: ProgramAnalysis,
  provenance: readonly NodeProvenance[],
): JsonPointer => {
  const ordered = [...provenance].sort(compareProvenance);
  if (violation.limit === 'nodes') {
    return crossingPath(ordered, violation.maximum, ({ programNodeId }) =>
      analysis.structure.nodeIds.has(programNodeId) ? 1 : 0,
    );
  }
  if (violation.limit === 'regions') {
    return crossingPath(ordered, violation.maximum, ({ programNodeId }) =>
      analysis.structure.regionIds.has(programNodeId) ? 1 : 0,
    );
  }
  if (violation.limit === 'targets') {
    return crossingPath(
      ordered,
      violation.maximum,
      ({ programNodeId }) => analysis.structure.nodeTargetCounts.get(programNodeId) ?? 0,
    );
  }
  return ordered[0]?.sourcePath ?? '';
};

export const admitLoweredProgram = (lowered: LoweredProgram): LoweredProgramAdmission => {
  const provenanceIds = new Set<string>();
  for (const record of lowered.nodeProvenance) {
    if (provenanceIds.has(record.programNodeId)) {
      const collector = createDiagnosticCollector();
      collector.add('LOWERING_ID_COLLISION', record.sourcePath);
      return Object.freeze({ ok: false, diagnostics: collector.finalize() });
    }
    provenanceIds.add(record.programNodeId);
  }
  const result = admitOwnedPipelineProgram(lowered.program);
  if (result.ok) {
    return Object.freeze({ ok: true, receipt: result.receipt });
  }
  const collector = createDiagnosticCollector();
  if (result.reason === 'bounds') {
    collector.add(
      'BOUND_EXCEEDED',
      violationPath(result.violation, result.analysis, lowered.nodeProvenance),
    );
  } else {
    collector.add('CANONICAL_INPUT', '');
  }
  return Object.freeze({ ok: false, diagnostics: collector.finalize() });
};
