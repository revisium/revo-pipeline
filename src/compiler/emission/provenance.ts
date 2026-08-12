import { compareUnicodeCodePoints, type DiagnosticCollector } from '../../foundation/index.js';
import type {
  NodeProvenance,
  ProgramProvenance,
  RequirementProvenance,
} from '../../program/index.js';
import type { ProgramStructure } from './structure.js';

export const emitProvenance = (
  nodes: readonly NodeProvenance[],
  requirements: readonly RequirementProvenance[],
  structure: ProgramStructure,
  collector: DiagnosticCollector,
): ProgramProvenance => {
  const structuralIds = new Set<string>();
  for (const id of structure.ids) {
    if (structuralIds.has(id)) {
      collector.add('LOWERING_ID_COLLISION', '');
    }
    structuralIds.add(id);
  }
  const provenanceIds = new Set<string>();
  for (const record of nodes) {
    if (provenanceIds.has(record.programNodeId)) {
      collector.add('LOWERING_ID_COLLISION', record.sourcePath);
    }
    provenanceIds.add(record.programNodeId);
  }
  if (
    structuralIds.size !== provenanceIds.size ||
    [...structuralIds].some((id) => !provenanceIds.has(id))
  ) {
    collector.add('LOWERING_ID_COLLISION', '');
  }
  return Object.freeze({
    schemaVersion: 'pipeline-provenance/v1',
    nodes: Object.freeze(
      [...nodes].sort((left, right) =>
        compareUnicodeCodePoints(left.programNodeId, right.programNodeId),
      ),
    ),
    requirements: Object.freeze(
      [...requirements].sort((left, right) =>
        compareUnicodeCodePoints(left.requirementKey, right.requirementKey),
      ),
    ),
  });
};
